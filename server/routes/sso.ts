import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { decodeProtectedHeader, jwtVerify, importSPKI, type JWTPayload } from 'jose';
import { db } from '../db.js';
import { users, memberships, partners, partnerGroupMappings, auditLog } from '../db/schema.js';
import { eq, and, inArray } from 'drizzle-orm';
import config from '../config.js';
import logger from '../utils/logger.js';
import { buildAuthResponse, buildAuthToken, listUserMemberships, setAuthCookie, parseExpiryToSeconds } from '../services/authSession.js';
import { createRefreshToken } from '../services/refreshToken.js';
import { setRefreshCookie } from './auth/rateLimit.js';
import { isPlatformAdmin } from '../services/roles.js';
import { getRedisClients } from '../utils/redis.js';
import { auth } from '../middleware/auth.js';
import { extractLocaleClaim, mapClaimToLocale, computeLocaleUpdate } from '../services/localeSync.js';
import { getStorage } from '../services/storage.js';

const router = express.Router();

// ---------------------------------------------------------------------------
// Azure Entra ID – OpenID Connect Authorization Code Flow
// ---------------------------------------------------------------------------
// 1. GET  /azure          → Redirect user to Microsoft login
// 2. GET  /azure/callback  → Exchange code for tokens, upsert user, auto-membership
// ---------------------------------------------------------------------------

const TENANT = () => config.AZURE_AD_TENANT_ID;
const CLIENT_ID = () => config.AZURE_AD_CLIENT_ID;
const CLIENT_SECRET = () => config.AZURE_AD_CLIENT_SECRET;
const REDIRECT_URI = () => config.AZURE_AD_REDIRECT_URI;

function ensureConfigured(): boolean {
  return !!(TENANT() && CLIENT_ID() && CLIENT_SECRET() && REDIRECT_URI());
}

// JWKS cache for Azure AD token signature verification
interface JwkKey { kid: string; kty: string; n?: string; e?: string; x5c?: string[]; [k: string]: unknown }
let cachedJwks: { tenantId: string; keys: JwkKey[]; fetchedAt: number } | null = null;
const JWKS_CACHE_TTL = 3600_000; // 1 hour

async function fetchJwks(): Promise<JwkKey[]> {
  const tenantId = TENANT()!;
  const now = Date.now();
  if (cachedJwks && cachedJwks.tenantId === tenantId && (now - cachedJwks.fetchedAt) < JWKS_CACHE_TTL) {
    return cachedJwks.keys;
  }
  const url = `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const body = await res.json() as { keys: JwkKey[] };
  cachedJwks = { tenantId, keys: body.keys, fetchedAt: now };
  return body.keys;
}

function jwkToPublicKey(jwk: JwkKey): string {
  // Use Node's crypto to convert JWK to PEM
  const keyObject = crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: 'jwk' });
  return keyObject.export({ type: 'spki', format: 'pem' }) as string;
}

async function getSigningKey(token: string): Promise<string> {
  const header = decodeProtectedHeader(token);
  if (!header?.kid) throw new Error('Token header missing kid');
  const keys = await fetchJwks();
  const key = keys.find(k => k.kid === header.kid);
  if (!key) {
    // Key not found — invalidate cache and retry once (key rotation)
    cachedJwks = null;
    const freshKeys = await fetchJwks();
    const freshKey = freshKeys.find(k => k.kid === header.kid);
    if (!freshKey) throw new Error(`Signing key not found for kid: ${header.kid}`);
    return jwkToPublicKey(freshKey);
  }
  return jwkToPublicKey(key);
}

// SSO CSRF state tokens stored in Redis with 10-minute TTL (multi-instance safe)
const SSO_STATE_PREFIX = 'sso:state:';
const SSO_STATE_TTL = 600; // 10 minutes

async function setSsoState(state: string, nonce: string): Promise<boolean> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) throw new Error('Redis not available');
    await pubClient.set(`${SSO_STATE_PREFIX}${state}`, JSON.stringify({ nonce, createdAt: Date.now() }), { EX: SSO_STATE_TTL });
    return true;
  } catch (err) {
    logger.error({ err }, '[SSO] Failed to store state in Redis');
    return false;
  }
}

async function getSsoState(state: string): Promise<{ nonce: string } | null> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) throw new Error('Redis not available');
    const raw = await pubClient.get(`${SSO_STATE_PREFIX}${state}`);
    if (!raw) return null;
    // Delete immediately (one-time use)
    await pubClient.del(`${SSO_STATE_PREFIX}${state}`);
    return JSON.parse(raw);
  } catch (err) {
    logger.error({ err }, '[SSO] Failed to retrieve state from Redis');
    return null;
  }
}

// Background sync of the user's Entra profile photo. Fire-and-forget from
// the SSO callback — first login shows initials, the photo lands in DB and
// appears on the next `user.me` fetch. Keeps SSO redirect zero-latency.
// Needs the `User.Read` scope that was added to authorize/token requests.
async function syncEntraPhoto(userId: string, accessToken: string): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const photoRes = await fetch('https://graph.microsoft.com/v1.0/me/photos/240x240/$value', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!photoRes.ok) {
      if (photoRes.status !== 404) {
        logger.warn({ userId, status: photoRes.status }, '[SSO] Graph photo fetch returned non-OK');
      }
      return;
    }
    const buf = Buffer.from(await photoRes.arrayBuffer());
    // Sanity cap: Entra thumbnails are ~20–60 KB; reject >1 MB as a safety
    // net against a misbehaving tenant/proxy returning junk.
    if (buf.length === 0 || buf.length >= 1024 * 1024) return;

    // Capture the previous avatar URL before overwriting — used below to
    // delete the old file and avoid leaking one orphan per login.
    const existing = (await db
      .select({ avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1))[0];
    const oldUrl = existing?.avatarUrl ?? null;

    const storage = getStorage();
    const filename = `avatar-${userId}-${Date.now()}.jpg`;
    const avatarUrl = await storage.upload(buf, filename, 'image/jpeg');
    await db.update(users).set({ avatarUrl }).where(eq(users.id, userId));

    // Best-effort cleanup of the previous auto-synced avatar. Gated on the
    // `avatar-{userId}-` prefix so a manually-uploaded (future) avatar with
    // a different naming scheme is left alone.
    if (oldUrl && oldUrl !== avatarUrl && oldUrl.startsWith('/uploads/')) {
      const oldFilename = oldUrl.slice('/uploads/'.length);
      if (oldFilename.startsWith(`avatar-${userId}-`)) {
        try {
          await storage.delete(oldFilename);
        } catch (err) {
          logger.warn({ userId, oldFilename, err: err instanceof Error ? err.message : String(err) }, '[SSO] Failed to delete old avatar');
        }
      }
    }

    logger.info({ userId, bytes: buf.length }, '[SSO] Synced Entra profile photo');
  } catch (err) {
    logger.warn({ userId, err: err instanceof Error ? err.message : String(err) }, '[SSO] Photo sync failed');
  }
}

// ---- Step 1: Redirect to Microsoft ----
router.get('/azure', async (_req: Request, res: Response) => {
  if (!ensureConfigured()) {
    return res.status(501).json({ error: 'Azure SSO is not configured' });
  }

  const state = crypto.randomBytes(32).toString('hex');
  const nonce = crypto.randomBytes(32).toString('hex');
  const stateStored = await setSsoState(state, nonce);

  if (!stateStored) {
    logger.error('[SSO] Cannot initiate SSO flow — Redis unavailable for state storage');
    return res.status(503).json({ error: 'SSO service temporarily unavailable. Please try again later.' });
  }

  const params = new URLSearchParams({
    client_id: CLIENT_ID()!,
    response_type: 'code',
    redirect_uri: REDIRECT_URI()!,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
    nonce,
  });

  const url = `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/authorize?${params}`;
  logger.info('[SSO] Redirecting to Azure AD');
  res.redirect(url);
});

// ---- Step 2: Callback – exchange code, upsert user, auto-membership ----
router.get('/azure/callback', async (req: Request, res: Response) => {
  const clientOrigin = config.FRONTEND_URL;

  try {
    if (!ensureConfigured()) {
      return res.status(501).json({ error: 'Azure SSO is not configured' });
    }

    const { code, state, error: azError, error_description } = req.query as Record<string, string>;

    if (azError) {
      logger.warn({ azError, error_description }, '[SSO] Azure returned error');
      // Map Azure error codes to generic user-facing messages (never expose raw error_description)
      const AZURE_ERROR_MAP: Record<string, string> = {
        access_denied: 'access_denied',
        consent_required: 'consent_required',
        interaction_required: 'interaction_required',
        login_required: 'login_required',
        invalid_client: 'configuration_error',
        unauthorized_client: 'configuration_error',
        unsupported_response_type: 'configuration_error',
        server_error: 'provider_error',
        temporarily_unavailable: 'provider_unavailable',
        invalid_request: 'invalid_request',
      };
      const safeError = AZURE_ERROR_MAP[azError] ?? 'sso_failed';
      return res.redirect(`${clientOrigin}/?sso_error=${encodeURIComponent(safeError)}`);
    }

    const pendingState = state ? await getSsoState(state) : null;
    if (!code || !state || !pendingState) {
      logger.warn('[SSO] Invalid or missing state/code');
      return res.redirect(`${clientOrigin}/?sso_error=invalid_state`);
    }
    const expectedNonce = pendingState.nonce;

    // Exchange authorization code for tokens
    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${TENANT()}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: CLIENT_ID()!,
          client_secret: CLIENT_SECRET()!,
          code,
          redirect_uri: REDIRECT_URI()!,
          grant_type: 'authorization_code',
          scope: 'openid profile email User.Read',
        }),
      }
    );

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      logger.error({ status: tokenRes.status, body: errBody }, '[SSO] Token exchange failed');
      return res.redirect(`${clientOrigin}/?sso_error=token_exchange_failed`);
    }

    const tokenData = await tokenRes.json() as { id_token: string; access_token: string };

    // Verify ID token signature against Microsoft's JWKS endpoint
    const idToken = tokenData.id_token;
    let payload: JWTPayload;
    try {
      const signingKeyPem = await getSigningKey(idToken);
      const publicKey = await importSPKI(signingKeyPem, 'RS256');
      const result = await jwtVerify(idToken, publicKey, {
        issuer: `https://login.microsoftonline.com/${TENANT()}/v2.0`,
        audience: CLIENT_ID()!,
        algorithms: ['RS256'],
      });
      payload = result.payload;
    } catch (verifyErr) {
      logger.error({ err: verifyErr instanceof Error ? verifyErr.message : String(verifyErr) }, '[SSO] ID token signature verification failed');
      return res.redirect(`${clientOrigin}/?sso_error=token_verification_failed`);
    }

    // Azure-specific claims from the verified payload
    const claims = payload as JWTPayload & { oid?: string; email?: string; preferred_username?: string; name?: string; groups?: string[]; _claim_names?: Record<string, string>; nonce?: string; locale?: string; xms_lang?: string; acct?: number; idp?: string };

    // Verify nonce to prevent token replay attacks
    if (claims.nonce !== expectedNonce) {
      logger.warn({ expected: expectedNonce, received: claims.nonce }, '[SSO] Nonce mismatch — possible replay attack');
      return res.redirect(`${clientOrigin}/?sso_error=nonce_mismatch`);
    }
    const oid: string = claims.oid || '';
    const email: string = (claims.email || claims.preferred_username || '').toLowerCase();
    const name: string = claims.name || email;

    // Azure B2B guest detection.
    //   acct === 1  → Microsoft documents this as "account type: guest" on the resource tenant.
    //   idp present → token includes a federated IdP claim, meaning the user's home tenant issued
    //                 the identity; the guest signed in against our tenant via B2B.
    // Either signal is sufficient. The `issuer` was already verified equal to our tenant, so `tid`
    // would be redundant here.
    const isExternal: boolean = claims.acct === 1 || !!claims.idp;

    // Locale claim resolved via the shared `localeSync` helper. Per-partner
    // attribute map (if configured) is applied after we identify the partner
    // further down; for the initial create/upsert we use the defaults.
    const claimsRecord = claims as unknown as Record<string, unknown>;
    const rawLocaleClaim = extractLocaleClaim(claimsRecord, null);
    const azureLang = mapClaimToLocale(rawLocaleClaim);

    if (!oid || !email) {
      logger.error({ hasOid: !!oid, hasEmail: !!email }, '[SSO] Missing oid or email in ID token');
      return res.redirect(`${clientOrigin}/?sso_error=missing_claims`);
    }

    logger.info({ oid, email }, '[SSO] Token decoded, upserting user');

    // ---- Upsert user ----
    let user = (await db.select().from(users).where(eq(users.externalId, oid)).limit(1))[0];

    if (!user) {
      // Try matching by email (user was pre-invited but hasn't logged in via SSO yet)
      user = (await db.select().from(users).where(eq(users.email, email)).limit(1))[0];

      if (user) {
        // Bound the claim-by-email window to INVITE_TTL_DAYS — an invite row older than
        // that is treated as abandoned and deleted rather than silently claimed.
        const INVITE_TTL_DAYS = 7;
        const ageMs = Date.now() - new Date(user.createdAt).getTime();
        if (ageMs > INVITE_TTL_DAYS * 86_400_000) {
          logger.warn({ userId: user.id, oid, email, ageMs }, '[SSO] Invite expired — rejecting claim and deleting stale row');
          await db.insert(auditLog).values({
            action: 'sso.invite_expired',
            targetType: 'user',
            targetId: user.id,
            metadata: { email, oid, ageMs },
          });
          await db.delete(users).where(eq(users.id, user.id));
          return res.redirect(`${clientOrigin}/login?sso_error=invite_expired`);
        }
        await db.update(users).set({ externalId: oid, name, isExternal }).where(eq(users.id, user.id));
        await db.insert(auditLog).values({
          action: 'sso.invite_claimed',
          actorId: user.id,
          targetType: 'user',
          targetId: user.id,
          metadata: { email, oid, ageMs },
        });
        logger.info({ userId: user.id, oid, isExternal, ageMs }, '[SSO] Linked existing user to Azure OID');
      } else {
        // Brand new SSO user
        const newId = crypto.randomUUID();
        await db.insert(users).values({
          id: newId,
          email,
          name,
          externalId: oid,
          isExternal,
          ...(azureLang && { lang: azureLang }),
        });
        user = (await db.select().from(users).where(eq(users.id, newId)).limit(1))[0];
        logger.info({ userId: newId, oid, isExternal }, '[SSO] Created new SSO user');
      }
    } else {
      // Sync locale from the IdP claim unless the user has explicitly locked
      // it via the UI (`users.langLocked = true`). See
      // `docs/superpowers/specs/2026-04-15-sso-locale-sync-design.md`.
      const nextLang = computeLocaleUpdate({
        currentLang: user.lang,
        langLocked: user.langLocked ?? false,
        claim: rawLocaleClaim,
      });
      await db
        .update(users)
        .set({ name, email, isExternal, ...(nextLang && { lang: nextLang }) })
        .where(eq(users.id, user.id));
      if (nextLang) {
        await db.insert(auditLog).values({
          action: 'user.locale.sso_sync',
          actorId: user.id,
          targetType: 'user',
          targetId: user.id,
          metadata: { from: user.lang, to: nextLang, claim: rawLocaleClaim },
        });
        user = { ...user, lang: nextLang };
      }
    }

    // Update lastActiveAt
    await db.update(users).set({ lastActiveAt: new Date().toISOString() }).where(eq(users.id, user.id));

    // Kick off Entra profile photo sync in the background. Non-blocking —
    // photo lands in DB and appears on next `user.me` fetch. See the helper
    // above for the actual Graph call + storage write.
    void syncEntraPhoto(user.id, tokenData.access_token);

    // ---- Auto-membership: group-based partner mapping ----
    const azureGroups: string[] = claims.groups || [];

    if (azureGroups.length === 0 && claims._claim_names?.groups) {
      // HI-05 fix: Group overage — Azure omitted groups claim (user has 200+ groups).
      logger.error(
        { userId: user.id, oid, claimNames: Object.keys(claims._claim_names || {}) },
        '[SSO] Group overage detected — Azure truncated groups claim (>200 groups).'
      );
    }

    if (azureGroups.length > 0) {
      const ROLE_PRIORITY: Record<string, number> = { admin: 3, support: 2, agent: 1 };

      // Look up which partners are mapped to these Azure groups
      const mappings = await db
        .select({
          partnerId: partnerGroupMappings.partnerId,
          azureGroupId: partnerGroupMappings.azureGroupId,
          defaultRole: partnerGroupMappings.defaultRole,
          defaultDepartments: partnerGroupMappings.defaultDepartments,
        })
        .from(partnerGroupMappings)
        .innerJoin(partners, eq(partnerGroupMappings.partnerId, partners.id))
        .where(and(
          inArray(partnerGroupMappings.azureGroupId, azureGroups),
          eq(partners.status, 'active'),
        ));

      // Resolve best role per partner based on groups
      type MembershipRole = 'agent' | 'support' | 'admin' | 'platform_operator';
      const targetMemberships = new Map<string, { role: MembershipRole, departments: string[] }>();
      for (const m of mappings) {
        const current = targetMemberships.get(m.partnerId);
        if (!current || (ROLE_PRIORITY[m.defaultRole] || 0) > (ROLE_PRIORITY[current.role] || 0)) {
          targetMemberships.set(m.partnerId, { 
            role: m.defaultRole, 
            departments: (m.defaultDepartments as string[]) || [] 
          });
        }
      }

      // Guest single-partner enforcement (Azure B2B guests must map to exactly one partner).
      // Fail-closed: if a guest is in groups that resolve to more than one partner it is a
      // misconfiguration in Azure (group assignment mistake or partner boundary bleed) and we
      // reject the login entirely rather than silently picking one. Internal staff keep the
      // existing multi-partner behavior (they use PartnerSwitcher mid-session).
      if (isExternal && targetMemberships.size > 1) {
        const partnerIdList = Array.from(targetMemberships.keys());
        logger.warn(
          { userId: user.id, partnerIds: partnerIdList, azureGroups },
          '[SSO] Guest rejected: mapped to multiple partners',
        );
        await db.insert(auditLog).values({
          action: 'sso.guest_multi_partner_rejected',
          actorId: user.id,
          targetType: 'user',
          targetId: user.id,
          // Audit metadata stays minimal (#45): partnerIds for diagnosis, groupCount only.
          // Full azureGroups array is in the structured log, not the audit DB.
          metadata: { partnerIds: partnerIdList, groupCount: azureGroups.length },
        });
        return res.redirect(`${clientOrigin}/?sso_error=guest_multi_partner_mapping`);
      }

      // Upsert current memberships (Force Sync)
      for (const [pId, target] of targetMemberships.entries()) {
        const existing = await db
          .select()
          .from(memberships)
          .where(and(eq(memberships.userId, user.id), eq(memberships.partnerId, pId)))
          .limit(1);

        // Admin members get all partner departments.
        // Support members whose group mapping has no departments default to all
        // (generalist) instead of landing unconfigured. Agents never carry depts.
        let depts = target.departments;
        const needsAllDepts = target.role === 'admin'
          || (target.role === 'support' && target.departments.length === 0);
        if (needsAllDepts) {
          const partner = await db.select({ departments: partners.departments }).from(partners).where(eq(partners.id, pId)).limit(1);
          const allDepts = (partner[0]?.departments as Array<{ id: string }>) || [];
          depts = allDepts.map(d => d.id);
        }

        if (existing.length === 0) {
          const mId = crypto.randomUUID();
          await db.insert(memberships).values({
            id: mId,
            userId: user.id,
            partnerId: pId,
            role: target.role,
            departments: depts,
            source: 'sso',
          });

          await db.insert(auditLog).values({
            action: 'sso.membership_auto_created',
            actorId: user.id,
            partnerId: pId,
            targetType: 'user',
            targetId: user.id,
            metadata: { role: target.role },
          });
          logger.info({ userId: user.id, partnerId: pId, role: target.role }, '[SSO] Auto-created membership');
        } else if (existing[0].source === 'sso' && existing[0].role !== target.role) {
          // Force role update if it changed in Azure
          await db.update(memberships)
            .set({ role: target.role, departments: depts })
            .where(eq(memberships.id, existing[0].id));

          await db.insert(auditLog).values({
            action: 'sso.role_synced',
            actorId: user.id,
            partnerId: pId,
            targetType: 'user',
            targetId: user.id,
            metadata: { oldRole: existing[0].role, newRole: target.role },
          });
          logger.info({ userId: user.id, partnerId: pId, oldRole: existing[0].role, newRole: target.role }, '[SSO] Synced role change from Azure');
        }
      }

      // Cleanup: Remove memberships for partners that HAVE SSO mappings if the user is no longer in those groups
      const allMappedPartners = await db
        .selectDistinct({ partnerId: partnerGroupMappings.partnerId })
        .from(partnerGroupMappings);
      const mappedPartnerIds = allMappedPartners.map(p => p.partnerId);

      if (mappedPartnerIds.length > 0) {
        const currentMemberships = await db.select().from(memberships).where(eq(memberships.userId, user.id));
        for (const cm of currentMemberships) {
          if (mappedPartnerIds.includes(cm.partnerId) && !targetMemberships.has(cm.partnerId) && cm.source === 'sso') {
            await db.delete(memberships).where(eq(memberships.id, cm.id));
            await db.insert(auditLog).values({
              action: 'sso.membership_revoked',
              actorId: user.id,
              partnerId: cm.partnerId,
              targetType: 'user',
              targetId: user.id,
              metadata: { reason: 'No matching SSO groups' },
            });
            logger.info({ userId: user.id, partnerId: cm.partnerId }, '[SSO] Revoked membership (no longer in Azure groups)');
          }
        }
      }
    }

    // ---- Build auth payload (same shape as local login) ----
    const userMemberships = await listUserMemberships(user.id);

    const activeMemberships = userMemberships.filter(m => m.status === 'active');
    const defaultMembership = activeMemberships.length > 0 ? activeMemberships[0] : null;

    // No memberships and not a platform operator → no access
    if (activeMemberships.length === 0 && !isPlatformAdmin(!!user.isPlatformOperator)) {
      logger.warn({ userId: user.id, oid, groupCount: azureGroups.length }, '[SSO] User authenticated but has no matching group mappings');
      await db.insert(auditLog).values({
        action: 'sso.no_matching_groups',
        actorId: user.id,
        targetType: 'user',
        targetId: user.id,
        metadata: { email, groupCount: azureGroups.length },
      });
      return res.redirect(`${clientOrigin}/?sso_error=no_matching_groups`);
    }

    const token = await buildAuthToken({
      userId: user.id,
      role: defaultMembership?.role || 'agent',
      departments: (defaultMembership?.departments as unknown[]) || [],
      partnerId: defaultMembership?.partnerId,
      membershipId: defaultMembership?.id,
      isPlatformOperator: !!user.isPlatformOperator,
    });

    // Build the SSO payload but store it server-side to avoid exposing user data in URL
    const ssoPayload = buildAuthResponse({
      user: {
        id: user.id,
        name: user.name,
        email: user.email ?? '',
        lang: user.lang,
        isPlatformOperator: user.isPlatformOperator,
        isExternal: user.isExternal,
        accessibilityPrefs: user.accessibilityPrefs ?? {},
        avatarUrl: user.avatarUrl,
      },
      memberships: userMemberships,
    });

    // Generate an opaque token and store the payload in Redis with a 60-second TTL.
    // The client will exchange this token via /api/auth/sso/exchange instead of
    // parsing sensitive user data directly from the URL hash fragment.
    const opaqueToken = crypto.randomUUID();
    try {
      const { pubClient } = getRedisClients();
      if (pubClient) {
        await pubClient.set(`sso:exchange:${opaqueToken}`, JSON.stringify(ssoPayload), { EX: 60 });
      } else {
        logger.error('[SSO] Redis not available for SSO exchange token storage');
        return res.redirect(`${clientOrigin}/?sso_error=internal_error`);
      }
    } catch (redisErr) {
      logger.error({ err: redisErr }, '[SSO] Failed to store SSO exchange token in Redis');
      return res.redirect(`${clientOrigin}/?sso_error=internal_error`);
    }

    logger.info({ userId: user.id, memberships: activeMemberships.length }, '[SSO] Login complete, redirecting');

    setAuthCookie(res, token, parseExpiryToSeconds(config.ACCESS_TOKEN_EXPIRY));
    // Issue refresh token (mirrors local login flow)
    const refreshResult = await createRefreshToken(user.id, defaultMembership?.partnerId);
    setRefreshCookie(res, refreshResult.token, parseExpiryToSeconds(config.REFRESH_TOKEN_EXPIRY));
    // Redirect with only the opaque token — no user data in the URL
    res.redirect(`${clientOrigin}/#sso_token=${opaqueToken}`);
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[SSO] Callback FATAL error');
    const fallbackOrigin = config.FRONTEND_URL;
    res.redirect(`${fallbackOrigin}/?sso_error=internal_error`);
  }
});

// ---- SSO Exchange: redeem opaque token for user payload ----
// CR-06: Require auth cookie to prevent unauthenticated token redemption
router.get('/exchange', auth as express.RequestHandler, async (req: Request, res: Response) => {
  try {
    const token = req.query.token as string;
    if (!token) {
      return res.status(400).json({ error: 'Token is required' });
    }

    const { pubClient } = getRedisClients();
    if (!pubClient) {
      return res.status(503).json({ error: 'Service unavailable' });
    }

    const key = `sso:exchange:${token}`;
    const raw = await pubClient.get(key);

    if (!raw) {
      return res.status(404).json({ error: 'Token expired or invalid' });
    }

    // Delete immediately — single use only
    await pubClient.del(key);

    const payload = JSON.parse(raw);
    res.json(payload);
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[SSO] Exchange FATAL error');
    res.status(500).json({ error: 'Server error during SSO exchange' });
  }
});

export default router;
