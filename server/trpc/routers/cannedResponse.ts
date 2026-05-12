import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, partnerScopedProcedure, partnerAdminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { cannedResponses, tickets } from '../../db/schema.js';
import { eq, and, asc, isNull, or } from 'drizzle-orm';
import { notFound, conflict } from '../../utils/trpcErrors.js';
import { canUseSupportWorkflows } from '../../services/roles.js';
import { trpcActor } from '../../services/auth/index.js';
import {
  translateCanned,
  isCannedTranslationEnabled,
  ALL_LANGS,
  type SupportedLang,
} from '../../services/ai/cannedTranslation.js';

const langEnum = z.enum(['nl', 'fr', 'en']);

export const cannedResponseRouter = router({
  /**
   * List canned responses for the current partner.
   * Support/admin can see all; optionally filter by department.
   */
  list: partnerScopedProcedure
    .input(z.object({ dept: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) return [];

      const conditions = [eq(cannedResponses.partnerId, ctx.user.partnerId)];

      if (input?.dept) {
        // Show responses for this dept + global ones (dept = null)
        conditions.push(or(eq(cannedResponses.dept, input.dept), isNull(cannedResponses.dept))!);
      }

      return db
        .select({
          id: cannedResponses.id,
          dept: cannedResponses.dept,
          title: cannedResponses.title,
          body: cannedResponses.body,
          shortcut: cannedResponses.shortcut,
          sourceLang: cannedResponses.sourceLang,
          bodyTranslations: cannedResponses.bodyTranslations,
          staleTranslations: cannedResponses.staleTranslations,
          createdAt: cannedResponses.createdAt,
        })
        .from(cannedResponses)
        .where(and(...conditions))
        .orderBy(asc(cannedResponses.title));
    }),

  /**
   * Create a new canned response (admin only).
   * When `cannedTranslation` is on, eagerly translates `body` to all
   * non-source languages and stores them in `body_translations`.
   */
  create: partnerAdminProcedure
    .input(z.object({
      title: z.string().min(1).max(100),
      body: z.string().min(1).max(5000),
      dept: z.string().optional(),
      shortcut: z.string().max(50).optional(),
      sourceLang: langEnum.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      trpcActor(ctx);
      // Validate shortcut uniqueness within partner
      if (input.shortcut) {
        const existing = await db
          .select({ id: cannedResponses.id })
          .from(cannedResponses)
          .where(and(
            eq(cannedResponses.partnerId, ctx.user.partnerId),
            eq(cannedResponses.shortcut, input.shortcut),
          ))
          .limit(1);

        if (existing.length > 0) {
          throw conflict(`Shortcut "${input.shortcut}" already exists`);
        }
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const sourceLang: SupportedLang = input.sourceLang ?? 'en';

      // Fan out translation BEFORE insert so the row lands fully populated.
      // If translation fails entirely, the canned still saves with `{}` translations.
      let bodyTranslations: Record<string, string> = {};
      if (await isCannedTranslationEnabled(ctx.user.partnerId)) {
        const translations = await translateCanned(
          ctx.user.partnerId,
          ctx.user.id,
          input.body,
          sourceLang,
        );
        bodyTranslations = translations as Record<string, string>;
      }

      await db.insert(cannedResponses).values({
        id,
        partnerId: ctx.user.partnerId,
        dept: input.dept || null,
        title: input.title,
        body: input.body,
        shortcut: input.shortcut || null,
        sourceLang,
        bodyTranslations,
        staleTranslations: {},
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });

      return {
        id,
        title: input.title,
        body: input.body,
        dept: input.dept ?? null,
        shortcut: input.shortcut ?? null,
        sourceLang,
        bodyTranslations,
        staleTranslations: {} as Record<string, boolean>,
        createdAt: now,
      };
    }),

  /**
   * Update a canned response (admin only).
   *
   * Stale-translation semantics:
   *   - If `body` changes, every existing translation is flagged stale.
   *   - If `bodyTranslations` is supplied, the languages it touches are
   *     cleared from the stale map (manual edit = "I've handled this").
   *   - The two interact: editing body + a single translation in one save
   *     marks every OTHER lang stale and clears the one that got an update.
   */
  update: partnerAdminProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).max(100).optional(),
      body: z.string().min(1).max(5000).optional(),
      dept: z.string().nullable().optional(),
      shortcut: z.string().max(50).nullable().optional(),
      sourceLang: langEnum.optional(),
      bodyTranslations: z.object({
        nl: z.string().max(5000).optional(),
        fr: z.string().max(5000).optional(),
        en: z.string().max(5000).optional(),
      }).strict().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      trpcActor(ctx);
      const [existing] = await db
        .select({
          id: cannedResponses.id,
          body: cannedResponses.body,
          sourceLang: cannedResponses.sourceLang,
          bodyTranslations: cannedResponses.bodyTranslations,
          staleTranslations: cannedResponses.staleTranslations,
        })
        .from(cannedResponses)
        .where(and(eq(cannedResponses.id, input.id), eq(cannedResponses.partnerId, ctx.user.partnerId)))
        .limit(1);

      if (!existing) throw notFound('Canned response');

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.body !== undefined) updates.body = input.body;
      if (input.dept !== undefined) updates.dept = input.dept;
      if (input.shortcut !== undefined) updates.shortcut = input.shortcut;
      if (input.sourceLang !== undefined) updates.sourceLang = input.sourceLang;

      const existingTranslations = (existing.bodyTranslations ?? {}) as Record<string, string>;
      const existingStale = (existing.staleTranslations ?? {}) as Record<string, boolean>;

      const bodyChanged = input.body !== undefined && input.body !== existing.body;
      // An empty `{}` input is treated as "no patch supplied" — avoids a
      // pointless rewrite of body_translations to its existing value.
      const translationsChanged = input.bodyTranslations !== undefined
        && Object.keys(input.bodyTranslations).length > 0;
      const effectiveSourceLang = (input.sourceLang ?? existing.sourceLang) as SupportedLang;
      const sourceLangChanged = input.sourceLang !== undefined && input.sourceLang !== existing.sourceLang;
      // The new source lang's entry in body_translations is now redundant
      // (the source body lives in `body`). Strip it so getForPicker doesn't
      // hand a stale translation back when callers query the source lang.
      const orphanLangFromSourceFlip = sourceLangChanged
        && existingTranslations[effectiveSourceLang] !== undefined;

      if (translationsChanged || bodyChanged || orphanLangFromSourceFlip) {
        // Patch semantics: input.bodyTranslations is a partial map. Each provided
        // key REPLACES the corresponding entry in the merged map; empty-string
        // deletes the entry. Languages absent from the input keep their existing
        // value.
        const nextTranslations: Record<string, string> = { ...existingTranslations };
        if (translationsChanged && input.bodyTranslations) {
          for (const [lang, val] of Object.entries(input.bodyTranslations)) {
            if (typeof val !== 'string' || val.length === 0) {
              delete nextTranslations[lang];
            } else {
              nextTranslations[lang] = val;
            }
          }
        }
        // Strip the new source lang's entry — it's redundant with `body`.
        if (orphanLangFromSourceFlip) {
          delete nextTranslations[effectiveSourceLang];
        }

        // Compute the new stale map.
        const nextStale: Record<string, boolean> = { ...existingStale };
        if (bodyChanged) {
          for (const lang of Object.keys(nextTranslations)) nextStale[lang] = true;
        }
        if (translationsChanged && input.bodyTranslations) {
          for (const lang of Object.keys(input.bodyTranslations)) {
            // Languages the admin manually wrote are no longer stale.
            delete nextStale[lang];
          }
        }
        // Drop stale entries whose translation no longer exists.
        for (const lang of Object.keys(nextStale)) {
          if (!(lang in nextTranslations)) delete nextStale[lang];
        }

        if (translationsChanged || orphanLangFromSourceFlip) {
          updates.bodyTranslations = nextTranslations;
        }
        updates.staleTranslations = nextStale;
      }

      await db
        .update(cannedResponses)
        .set(updates)
        .where(and(eq(cannedResponses.id, input.id), eq(cannedResponses.partnerId, ctx.user.partnerId)));
      return { success: true };
    }),

  /**
   * Force-regenerate translations for one or more languages (admin only,
   * feature-gated). When `langs` is omitted, regenerates every language
   * currently flagged stale; if nothing is stale, regenerates all non-source
   * languages.
   */
  regenerate: partnerAdminProcedure
    .input(z.object({
      id: z.string(),
      langs: z.array(langEnum).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      trpcActor(ctx);
      if (!(await isCannedTranslationEnabled(ctx.user.partnerId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Canned translation is not enabled for this partner',
        });
      }

      const [row] = await db
        .select({
          body: cannedResponses.body,
          sourceLang: cannedResponses.sourceLang,
          bodyTranslations: cannedResponses.bodyTranslations,
          staleTranslations: cannedResponses.staleTranslations,
        })
        .from(cannedResponses)
        .where(and(eq(cannedResponses.id, input.id), eq(cannedResponses.partnerId, ctx.user.partnerId)))
        .limit(1);

      if (!row) throw notFound('Canned response');

      const sourceLang = row.sourceLang as SupportedLang;
      let targets: SupportedLang[];
      if (input.langs && input.langs.length > 0) {
        targets = input.langs.filter((l) => l !== sourceLang);
      } else {
        const stale = (row.staleTranslations ?? {}) as Record<string, boolean>;
        const staleLangs = Object.keys(stale).filter((l) => stale[l]) as SupportedLang[];
        targets = staleLangs.length > 0
          ? staleLangs
          : ALL_LANGS.filter((l) => l !== sourceLang);
      }

      if (targets.length === 0) {
        return { success: true, translated: [] as SupportedLang[] };
      }

      const translations = await translateCanned(
        ctx.user.partnerId,
        ctx.user.id,
        row.body,
        sourceLang,
        targets,
      );

      const merged: Record<string, string> = {
        ...((row.bodyTranslations ?? {}) as Record<string, string>),
      };
      const remainingStale: Record<string, boolean> = {
        ...((row.staleTranslations ?? {}) as Record<string, boolean>),
      };
      const translated: SupportedLang[] = [];
      for (const target of targets) {
        const value = translations[target];
        if (typeof value === 'string') {
          merged[target] = value;
          delete remainingStale[target];
          translated.push(target);
        }
      }

      await db
        .update(cannedResponses)
        .set({
          bodyTranslations: merged,
          staleTranslations: remainingStale,
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(cannedResponses.id, input.id), eq(cannedResponses.partnerId, ctx.user.partnerId)));

      return { success: true, translated };
    }),

  /**
   * List canned responses with `body` resolved to the ticket's recipient
   * language. Used by the support compose picker so the inserted message is
   * already translated. Returns the source body when the feature is off,
   * the recipient lang matches source, or the requested translation is
   * missing/empty.
   */
  getForPicker: partnerScopedProcedure
    .input(z.object({
      ticketId: z.string(),
      dept: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      if (!canUseSupportWorkflows(ctx.user.role, ctx.user.isPlatformOperator)) return [];

      const [ticket] = await db
        .select({ agentLang: tickets.agentLang })
        .from(tickets)
        .where(and(eq(tickets.id, input.ticketId), eq(tickets.partnerId, ctx.user.partnerId)))
        .limit(1);
      if (!ticket) return [];

      const recipientLang = (ticket.agentLang ?? null) as SupportedLang | null;
      const featureOn = await isCannedTranslationEnabled(ctx.user.partnerId);

      const conditions = [eq(cannedResponses.partnerId, ctx.user.partnerId)];
      if (input.dept) {
        conditions.push(or(eq(cannedResponses.dept, input.dept), isNull(cannedResponses.dept))!);
      }

      const rows = await db
        .select({
          id: cannedResponses.id,
          dept: cannedResponses.dept,
          title: cannedResponses.title,
          body: cannedResponses.body,
          shortcut: cannedResponses.shortcut,
          sourceLang: cannedResponses.sourceLang,
          bodyTranslations: cannedResponses.bodyTranslations,
        })
        .from(cannedResponses)
        .where(and(...conditions))
        .orderBy(asc(cannedResponses.title));

      return rows.map((r) => {
        let body = r.body;
        if (featureOn && recipientLang && recipientLang !== r.sourceLang) {
          const translations = (r.bodyTranslations ?? {}) as Record<string, string>;
          const translated = translations[recipientLang];
          if (typeof translated === 'string' && translated.length > 0) {
            body = translated;
          }
        }
        return {
          id: r.id,
          dept: r.dept,
          title: r.title,
          body,
          shortcut: r.shortcut,
        };
      });
    }),

  /**
   * Translate every canned in the partner that currently has empty
   * `body_translations`. Admin-gated, feature-gated. Returns counts
   * of attempted vs. fully-populated rows. Failures per-row are silent
   * (matches the per-canned `create` semantics).
   */
  backfillUntranslated: partnerAdminProcedure
    .mutation(async ({ ctx }) => {
      trpcActor(ctx);
      if (!(await isCannedTranslationEnabled(ctx.user.partnerId))) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Canned translation is not enabled for this partner',
        });
      }

      const rows = await db
        .select({
          id: cannedResponses.id,
          body: cannedResponses.body,
          sourceLang: cannedResponses.sourceLang,
          bodyTranslations: cannedResponses.bodyTranslations,
        })
        .from(cannedResponses)
        .where(eq(cannedResponses.partnerId, ctx.user.partnerId));

      const candidates = rows.filter((r) => {
        const t = (r.bodyTranslations ?? {}) as Record<string, string>;
        return Object.keys(t).length === 0;
      });

      let translatedCount = 0;
      for (const row of candidates) {
        const sourceLang = row.sourceLang as SupportedLang;
        const translations = await translateCanned(
          ctx.user.partnerId,
          ctx.user.id,
          row.body,
          sourceLang,
        );
        if (Object.keys(translations).length === 0) continue;

        await db
          .update(cannedResponses)
          .set({
            bodyTranslations: translations as Record<string, string>,
            staleTranslations: {},
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(cannedResponses.id, row.id), eq(cannedResponses.partnerId, ctx.user.partnerId)));
        translatedCount += 1;
      }

      return { attempted: candidates.length, translated: translatedCount };
    }),

  /**
   * Delete a canned response (admin only).
   */
  delete: partnerAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      trpcActor(ctx);
      await db
        .delete(cannedResponses)
        .where(and(eq(cannedResponses.id, input.id), eq(cannedResponses.partnerId, ctx.user.partnerId)));

      return { success: true };
    }),
});
