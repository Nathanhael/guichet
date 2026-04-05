import express, { Request, Response } from 'express';
import crypto from 'crypto';
import { decodeProtectedHeader, jwtVerify, importSPKI, type JWTPayload } from 'jose';
import { db } from '../db.js';
import { users, memberships, partners, partnerGroupMappings, auditLog } from '../db/schema.js';
import { eq, and, inArray, or } from 'drizzle-orm';
import config from '../config.js';
import logger from '../utils/logger.js';
import { buildAuthResponse, buildAuthToken, listUserMemberships, setAuthCookie, parseExpiryToSeconds } from '../services/authSession.js';
import { isPlatformAdmin } from '../services/roles.js';
import { getRedisClients } from '../utils/redis.js';
import { auth } from '../middleware/auth.js';

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

// ---- Step 1: Redirect to Microsoft ----
router.get('/azure', async (req: Request, res: Response) => {
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
    scope: 'openid profile email',
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
          scope: 'openid profile email',
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
    const claims = payload as JWTPayload & { oid?: string; email?: string; preferred_username?: string; name?: string; groups?: string[]; _claim_names?: Record<string, string>; nonce?: string; locale?: string; xms_lang?: string };

    // Verify nonce to prevent token replay attacks
    if (claims.nonce !== expectedNonce) {
      logger.warn({ expected: expectedNonce, received: claims.nonce }, '[SSO] Nonce mismatch — possible replay attack');
      return res.redirect(`${clientOrigin}/?sso_error=nonce_mismatch`);
    }
    const oid: string = claims.oid || '';
    const email: string = (claims.email || claims.preferred_username || '').toLowerCase();
    const name: string = claims.name || email;

    // Map Azure locale claim to supported Tessera languages (nl, fr, en)
    const SUPPORTED_LANGS = ['nl', 'fr', 'en'] as const;
    type SupportedLang = typeof SUPPORTED_LANGS[number];
    const rawLang = claims.locale ?? claims.xms_lang;
    const azureLang: SupportedLang | null = rawLang
      ? (SUPPORTED_LANGS.includes(rawLang.slice(0, 2).toLowerCase() as SupportedLang)
          ? (rawLang.slice(0, 2).toLowerCase() as SupportedLang)
          : null)
      : null;

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
        // Security: Only link SSO identity to accounts that don't have a local password set.
        // If the user has a password, they are a local-auth account and linking a new SSO
        // identity to them would allow account takeover — an attacker who controls an SSO
        // identity with the same email could hijack the local account.
        if (user.password) {
          logger.warn({ userId: user.id, oid, email }, '[SSO] Email conflict: SSO identity matches existing local-auth account — rejecting login');
          await db.insert(auditLog).values({
            action: 'sso.email_conflict',
            actorId: user.id,
            targetType: 'user',
            targetId: user.id,
            metadata: { email, oid },
          });
          return res.redirect(`${clientOrigin}/login?sso_error=email_conflict`);
        } else {
          // Safe to link: account has no password (SSO-only or uninitialised invite)
          await db.update(users).set({ externalId: oid, name }).where(eq(users.id, user.id));
          logger.info({ userId: user.id, oid }, '[SSO] Linked existing user to Azure OID');
        }
      } else {
        // Brand new SSO user
        const newId = crypto.randomUUID();
        await db.insert(users).values({
          id: newId,
          email,
          name,
          externalId: oid,
          password: null,
          ...(azureLang && { lang: azureLang }),
        });
        user = (await db.select().from(users).where(eq(users.id, newId)).limit(1))[0];
        logger.info({ userId: newId, oid }, '[SSO] Created new SSO user');
      }
    } else {
      // Update name/email if changed in Azure (intentionally NOT updating lang —
      // the user may have manually switched language via the UI, and we don't
      // want Azure to overwrite that choice on every login)
      await db.update(users).set({ name, email }).where(eq(users.id, user.id));
    }

    // Update lastActiveAt
    await db.update(users).set({ lastActiveAt: new Date().toISOString() }).where(eq(users.id, user.id));

    // ---- Auto-membership: group-based partner mapping ----
    const azureGroups: string[] = claims.groups || [];

    if (azureGroups.length === 0 && claims._claim_names?.groups) {
      // HI-05 fix: Group overage — Azure omitted groups claim (user has 200+ groups).
      // Without the full group list, role/department mappings cannot be applied correctly.
      // Log an actionable error and continue login without group-based assignments.
      // To fully resolve: call Microsoft Graph API /me/memberOf with the access_token.
      logger.error(
        { userId: user.id, oid, claimNames: Object.keys(claims._claim_names || {}) },
        '[SSO] Group overage detected — Azure truncated groups claim (>200 groups). ' +
        'Group-based partner mappings will NOT be applied for this user. ' +
        'Configure fewer groups or implement Graph API fallback.'
      );
    }

    if (azureGroups.length > 0) {
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
          or(eq(partners.authMethod, 'sso'), eq(partners.authMethod, 'both')),
          eq(partners.status, 'active'),
        ));

      for (const mapping of mappings) {
        const existing = await db
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.userId, user.id), eq(memberships.partnerId, mapping.partnerId)))
          .limit(1);

        if (existing.length === 0) {
          const mId = crypto.randomUUID();
          await db.insert(memberships).values({
            id: mId,
            userId: user.id,
            partnerId: mapping.partnerId,
            role: mapping.defaultRole,
            departments: (mapping.defaultDepartments as string[]) || [],
          });

          await db.insert(auditLog).values({
            action: 'sso.membership_auto_created',
            actorId: user.id,
            partnerId: mapping.partnerId,
            targetType: 'user',
            targetId: user.id,
            metadata: { azureGroupId: mapping.azureGroupId, role: mapping.defaultRole },
          });

          logger.info({ userId: user.id, partnerId: mapping.partnerId, membershipId: mId, azureGroupId: mapping.azureGroupId }, '[SSO] Auto-created membership via group mapping');
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
        email: user.email,
        lang: user.lang,
        isPlatformOperator: user.isPlatformOperator,
        accessibilityPrefs: user.accessibilityPrefs ?? {},
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
