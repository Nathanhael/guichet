import express, { Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import * as jose from 'jose';
import { v4 as uuid } from 'uuid';
import { db } from '../db.js';
import { users, memberships, partners, partnerGroupMappings, auditLog } from '../db/schema.js';
import { eq, and, inArray, or } from 'drizzle-orm';
import config from '../config.js';
import logger from '../utils/logger.js';
import { buildAuthResponse, buildAuthToken, listUserMemberships } from '../services/authSession.js';
import { isPlatformAdmin } from '../services/roles.js';
import { getRedisClients } from '../utils/redis.js';

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

// Lazily-created JWKS client for Azure AD token signature verification
let cachedJwks: { tenantId: string; jwks: ReturnType<typeof jose.createRemoteJWKSet> } | null = null;
function getJwks() {
  const tenantId = TENANT()!;
  if (!cachedJwks || cachedJwks.tenantId !== tenantId) {
    cachedJwks = {
      tenantId,
      jwks: jose.createRemoteJWKSet(
        new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
      ),
    };
  }
  return cachedJwks.jwks;
}

// SSO CSRF state tokens stored in Redis with 10-minute TTL (multi-instance safe)
const SSO_STATE_PREFIX = 'sso:state:';
const SSO_STATE_TTL = 600; // 10 minutes

async function setSsoState(state: string, nonce: string): Promise<void> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) throw new Error('Redis not available');
    await pubClient.set(`${SSO_STATE_PREFIX}${state}`, JSON.stringify({ nonce, createdAt: Date.now() }), { EX: SSO_STATE_TTL });
  } catch (err) {
    logger.error({ err }, '[SSO] Failed to store state in Redis');
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
  await setSsoState(state, nonce);

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
  const clientOrigin = config.CORS_ORIGIN.split(',')[0];

  try {
    if (!ensureConfigured()) {
      return res.status(501).json({ error: 'Azure SSO is not configured' });
    }

    const { code, state, error: azError, error_description } = req.query as Record<string, string>;

    if (azError) {
      logger.warn({ azError, error_description }, '[SSO] Azure returned error');
      return res.redirect(`${clientOrigin}/?sso_error=${encodeURIComponent(error_description || azError)}`);
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
    let payload: jose.JWTPayload;
    try {
      const result = await jose.jwtVerify(idToken, getJwks(), {
        issuer: `https://login.microsoftonline.com/${TENANT()}/v2.0`,
        audience: CLIENT_ID()!,
      });
      payload = result.payload;
    } catch (verifyErr) {
      logger.error({ err: verifyErr instanceof Error ? verifyErr.message : String(verifyErr) }, '[SSO] ID token signature verification failed');
      return res.redirect(`${clientOrigin}/?sso_error=token_verification_failed`);
    }

    // Azure-specific claims from the verified payload
    const claims = payload as jose.JWTPayload & { oid?: string; email?: string; preferred_username?: string; name?: string; groups?: string[]; _claim_names?: Record<string, string> };

    // Verify nonce to prevent token replay attacks
    if (claims.nonce !== expectedNonce) {
      logger.warn({ expected: expectedNonce, received: claims.nonce }, '[SSO] Nonce mismatch — possible replay attack');
      return res.redirect(`${clientOrigin}/?sso_error=nonce_mismatch`);
    }
    const oid: string = claims.oid || '';
    const email: string = (claims.email || claims.preferred_username || '').toLowerCase();
    const name: string = claims.name || email;

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
        // Link existing user to this Azure OID
        await db.update(users).set({ externalId: oid, name }).where(eq(users.id, user.id));
        logger.info({ userId: user.id, oid }, '[SSO] Linked existing user to Azure OID');
      } else {
        // Brand new SSO user
        const newId = uuid();
        await db.insert(users).values({
          id: newId,
          email,
          name,
          externalId: oid,
          password: null,
        });
        user = (await db.select().from(users).where(eq(users.id, newId)).limit(1))[0];
        logger.info({ userId: newId, oid }, '[SSO] Created new SSO user');
      }
    } else {
      // Update name/email if changed in Azure
      await db.update(users).set({ name, email }).where(eq(users.id, user.id));
    }

    // Update lastActiveAt
    await db.update(users).set({ lastActiveAt: new Date().toISOString() }).where(eq(users.id, user.id));

    // ---- Auto-membership: group-based partner mapping ----
    const azureGroups: string[] = claims.groups || [];

    if (azureGroups.length === 0 && claims._claim_names?.groups) {
      // Group overage — Azure omitted groups claim (user has 200+ groups)
      logger.warn({ userId: user.id, oid }, '[SSO] Group overage detected — groups claim missing, _claim_names present. User may need manual membership.');
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
          const mId = uuid();
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
        metadata: { email, azureGroups },
      });
      return res.redirect(`${clientOrigin}/?sso_error=no_matching_groups`);
    }

    const token = buildAuthToken({
      userId: user.id,
      role: defaultMembership?.role || 'agent',
      departments: (defaultMembership?.departments as unknown[]) || [],
      partnerId: defaultMembership?.partnerId,
      membershipId: defaultMembership?.id,
      isPlatformOperator: !!user.isPlatformOperator,
    });

    // Redirect back to client with token + user data as URL fragment
    // Fragment (#) is never sent to the server — safe for tokens
    const ssoPayload = buildAuthResponse({
      token,
      user: {
        id: user.id,
        name: user.name,
        lang: user.lang,
        isPlatformOperator: user.isPlatformOperator,
      },
      memberships: userMemberships,
    });

    const encodedPayload = encodeURIComponent(JSON.stringify(ssoPayload));
    logger.info({ userId: user.id, memberships: activeMemberships.length }, '[SSO] Login complete, redirecting');

    // Redirect to client origin with SSO data in the hash fragment
    res.redirect(`${clientOrigin}/#sso_callback=${encodedPayload}`);
  } catch (err: unknown) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, '[SSO] Callback FATAL error');
    const fallbackOrigin = config.CORS_ORIGIN.split(',')[0];
    res.redirect(`${fallbackOrigin}/?sso_error=internal_error`);
  }
});

export default router;
