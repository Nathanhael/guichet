import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { router, partnerScopedProcedure, partnerAdminProcedure } from '../trpc.js';
import { db } from '../../db.js';
import { kbArticles } from '../../db/schema.js';
import { eq, and, asc, ilike, or, sql } from 'drizzle-orm';
import { notFound } from '../../utils/trpcErrors.js';
import logger from '../../utils/logger.js';


function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/* Shared select columns to avoid repetition */
const articleListColumns = {
  id: kbArticles.id,
  title: kbArticles.title,
  body: kbArticles.body,
  dept: kbArticles.dept,
  tags: kbArticles.tags,
  slug: kbArticles.slug,
} as const;

export const kbRouter = router({
  /**
   * List KB articles for the current partner.
   * All authenticated users can view published articles; admin sees drafts too.
   */
  list: partnerScopedProcedure
    .input(z.object({
      dept: z.string().optional(),
      tag: z.string().optional(),
      includeUnpublished: z.boolean().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const conditions = [eq(kbArticles.partnerId, ctx.user.partnerId)];

      // Non-admin users only see published
      const isAdmin = ctx.user.role === 'admin' || ctx.user.isPlatformOperator;
      if (!isAdmin || !input?.includeUnpublished) {
        conditions.push(eq(kbArticles.published, true));
      }

      if (input?.dept) {
        conditions.push(
          or(eq(kbArticles.dept, input.dept), sql`${kbArticles.dept} IS NULL`)!
        );
      }

      // Push tag filter to Postgres using JSONB @> operator
      if (input?.tag) {
        conditions.push(sql`${kbArticles.tags} @> ${JSON.stringify([input.tag])}::jsonb`);
      }

      return db
        .select({
          ...articleListColumns,
          published: kbArticles.published,
          createdAt: kbArticles.createdAt,
          updatedAt: kbArticles.updatedAt,
        })
        .from(kbArticles)
        .where(and(...conditions))
        .orderBy(asc(kbArticles.title));
    }),

  /**
   * Full-text keyword search across title + body.
   */
  search: partnerScopedProcedure
    .input(z.object({ query: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const q = `%${input.query}%`;

      return db
        .select(articleListColumns)
        .from(kbArticles)
        .where(and(
          eq(kbArticles.partnerId, ctx.user.partnerId),
          eq(kbArticles.published, true),
          or(ilike(kbArticles.title, q), ilike(kbArticles.body, q))
        ))
        .orderBy(asc(kbArticles.title))
        .limit(20);
    }),

  /**
   * AI-powered search — ask a question, get relevant articles ranked by relevance.
   * Falls back to keyword search when AI is unavailable.
   */
  aiSearch: partnerScopedProcedure
    .input(z.object({ question: z.string().min(1).max(500) }))
    .query(async ({ ctx, input }) => {
      // Fetch all published articles for this partner
      const articles = await db
        .select(articleListColumns)
        .from(kbArticles)
        .where(and(
          eq(kbArticles.partnerId, ctx.user.partnerId),
          eq(kbArticles.published, true)
        ))
        .orderBy(asc(kbArticles.title));

      if (articles.length === 0) {
        return { articles: [], aiAnswer: 'No knowledge base articles found.' };
      }

      // Try AI-powered ranking
      try {
        const { getProvider } = await import('../../services/ai/factory.js');
        const { logUsage } = await import('../../services/ai/usage.js');
        const { checkRateLimit } = await import('../../services/ai/rateLimit.js');
        const { isFeatureEnabled } = await import('../../services/ai/config.js');

        // Feature gate: require AI to be enabled for this partner
        const enabled = await isFeatureEnabled(ctx.user.partnerId, 'chatSummarization');
        if (!enabled) throw new Error('AI features disabled for this partner');

        // Rate limit check
        const limit = await checkRateLimit(ctx.user.partnerId);
        if (!limit.allowed) throw new Error('AI rate limit exceeded');

        const provider = await getProvider(ctx.user.partnerId);
        if (!(await provider.isAvailable())) throw new Error('AI provider unavailable');

        const articleSummaries = articles
          .map((a, i) => `[${i}] ${a.title}: ${a.body.slice(0, 300)}`)
          .join('\n');

        const start = Date.now();
        const result = await provider.chat({
          model: '', // uses partner default
          messages: [
            {
              role: 'system',
              content: `You are a knowledge base search assistant. Given a user question and a list of KB articles, return:
1. A JSON array of article indices (0-based) ranked by relevance, max 5.
2. A brief answer synthesized from the relevant articles.
Format: {"indices": [0, 3, 1], "answer": "Based on the KB..."}
Only return valid JSON, nothing else.`,
            },
            {
              role: 'user',
              content: `Question: <user_content>${input.question.replace(/<\/?user_content\s*>/gi, '')}</user_content>\n\nArticles:\n${articleSummaries}`,
            },
          ],
          temperature: 0.1,
          maxTokens: 500,
        });

        await logUsage({
          partnerId: ctx.user.partnerId,
          userId: ctx.user.id,
          action: 'suggest',
          provider: provider.name,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: Date.now() - start,
          success: true,
        });

        let parsed: unknown;
        try {
          parsed = JSON.parse(result.content);
        } catch {
          logger.warn('AI returned malformed JSON for KB suggest, falling back to keyword search');
          throw new Error('malformed-ai-response');
        }

        const parsedObj = parsed as Record<string, unknown>;
        if (!Array.isArray(parsedObj.indices)) {
          logger.warn('AI response missing indices array for KB suggest, falling back to keyword search');
          throw new Error('malformed-ai-response');
        }

        const rankedArticles = (parsedObj.indices as number[])
          .filter((i) => typeof i === 'number' && i >= 0 && i < articles.length)
          .map((i) => articles[i]);

        return {
          articles: rankedArticles,
          aiAnswer: typeof parsedObj.answer === 'string' ? parsedObj.answer : '',
        };
      } catch {
        // Fallback to keyword search
        const q = `%${input.question}%`;
        const fallback = await db
          .select(articleListColumns)
          .from(kbArticles)
          .where(and(
            eq(kbArticles.partnerId, ctx.user.partnerId),
            eq(kbArticles.published, true),
            or(ilike(kbArticles.title, q), ilike(kbArticles.body, q))
          ))
          .limit(5);

        return {
          articles: fallback,
          aiAnswer: '',
        };
      }
    }),

  /** Get a single article by ID */
  getById: partnerScopedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select()
        .from(kbArticles)
        .where(and(eq(kbArticles.id, input.id), eq(kbArticles.partnerId, ctx.user.partnerId)))
        .limit(1);

      return rows[0] || null;
    }),

  /** Create a new KB article (admin only) */
  create: partnerAdminProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      body: z.string().min(1).max(50000),
      dept: z.string().optional(),
      tags: z.array(z.string()).optional(),
      slug: z.string().max(80).optional(),
      published: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const id = uuidv4();
      const now = new Date().toISOString();
      const slug = input.slug?.trim() || slugify(input.title);

      await db.insert(kbArticles).values({
        id,
        partnerId: ctx.user.partnerId,
        title: input.title,
        body: input.body,
        dept: input.dept || null,
        tags: input.tags || [],
        slug,
        published: input.published ?? true,
        createdBy: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      });

      return { id, slug };
    }),

  /** Update a KB article (admin only) */
  update: partnerAdminProcedure
    .input(z.object({
      id: z.string(),
      title: z.string().min(1).max(200).optional(),
      body: z.string().min(1).max(50000).optional(),
      dept: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      slug: z.string().max(80).nullable().optional(),
      published: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const existing = await db
        .select({ id: kbArticles.id })
        .from(kbArticles)
        .where(and(eq(kbArticles.id, input.id), eq(kbArticles.partnerId, ctx.user.partnerId)))
        .limit(1);

      if (existing.length === 0) throw notFound('Article');

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.body !== undefined) updates.body = input.body;
      if (input.dept !== undefined) updates.dept = input.dept;
      if (input.tags !== undefined) updates.tags = input.tags;
      if (input.slug !== undefined) updates.slug = input.slug;
      if (input.published !== undefined) updates.published = input.published;

      await db.update(kbArticles).set(updates).where(and(eq(kbArticles.id, input.id), eq(kbArticles.partnerId, ctx.user.partnerId)));
      return { success: true };
    }),

  /** Delete a KB article (admin only) */
  delete: partnerAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(kbArticles)
        .where(and(eq(kbArticles.id, input.id), eq(kbArticles.partnerId, ctx.user.partnerId)));

      return { success: true };
    }),
});
