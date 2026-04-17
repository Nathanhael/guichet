import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc.js';
import { fetchOgData, extractUrls, type LinkPreview } from '../../services/linkPreview.js';
import { getRedisClients } from '../../utils/redis.js';
import logger from '../../utils/logger.js';

// Per-user budget for the compose-time preview. The global tRPC IP limiter
// (200/min) caps the overall blast radius; this adds a per-identity cap so a
// single compromised account can't ride the IP budget alone to probe external
// hosts through the server's egress. 20/min = generous for a human typing,
// tight enough to kill automation.
const LINK_PREVIEW_WINDOW_SECS = 60;
const LINK_PREVIEW_MAX_PER_WINDOW = 20;

async function enforcePerUserLimit(userId: string): Promise<void> {
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) {
      // Redis unavailable — fail open. The SSRF guard in fetchOgData still
      // applies; worst case is the global tRPC limiter takes the slack.
      return;
    }
    const key = `rl:lp:${userId}`;
    const count = await pubClient.incr(key);
    if (count === 1) {
      await pubClient.expire(key, LINK_PREVIEW_WINDOW_SECS);
    }
    if (count > LINK_PREVIEW_MAX_PER_WINDOW) {
      logger.warn({ userId, count }, '[linkPreview] per-user rate limit exceeded');
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Too many link previews — slow down for a moment.',
      });
    }
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    // Redis error (not a rejection) — fail open, same reasoning as above.
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, '[linkPreview] rate limit check failed, allowing');
  }
}

/**
 * On-demand link preview unfurling for the compose area.
 *
 * Existing socket flow already unfurls URLs when a message is sent
 * (see `services/linkPreview.ts::unfurlLinks` + the
 * `message:linkPreview` broadcast). This router adds a *pre-send*
 * lookup so support staff can verify the preview card renders
 * correctly before shipping the message.
 *
 * Accepts the full current compose text (not just a URL) so the
 * server can extract the first valid URL on its end — the client
 * doesn't have to duplicate the regex / ExtractUrls logic.
 */
export const linkPreviewRouter = router({
  /**
   * Takes the current compose text, finds the first URL, unfurls it
   * via the shared fetchOgData pipeline (same SSRF guards, same
   * Redis cache, same timeout). Returns null when no URL is present
   * or the fetch fails — the client treats null as "nothing to show".
   */
  fetchForCompose: protectedProcedure
    .input(z.object({
      text: z.string().max(5500), // a bit of headroom over the 5000 server cap
    }))
    .query(async ({ ctx, input }): Promise<LinkPreview | null> => {
      // Enforce BEFORE URL extraction so abusers can't burn CPU/regex cycles.
      if (ctx.user) await enforcePerUserLimit(ctx.user.id);
      const urls = extractUrls(input.text);
      if (urls.length === 0) return null;
      // Only the first URL — previewing every URL inline would be
      // visual noise while typing. The sent-message path still
      // unfurls up to MAX_URLS (3) for the stored message render.
      const first = urls[0];
      try {
        return await fetchOgData(first);
      } catch (err) {
        logger.debug({ err: err instanceof Error ? err.message : String(err), url: first }, '[linkPreview] compose fetch failed');
        return null;
      }
    }),
});
