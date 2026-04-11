import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';
import { fetchOgData, extractUrls, type LinkPreview } from '../../services/linkPreview.js';
import logger from '../../utils/logger.js';

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
    .query(async ({ input }): Promise<LinkPreview | null> => {
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
