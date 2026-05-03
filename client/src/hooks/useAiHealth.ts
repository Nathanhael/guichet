import { trpc } from '../utils/trpc';

const POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface AiHealth {
  available: boolean;
  lastChecked: string | null;
}

/**
 * Polls the server's AI provider health and exposes a simple gate flag.
 * Components use this to disable AI-driven affordances (improve / mic) when
 * the provider is unreachable.
 */
export function useAiHealth(opts?: { enabled?: boolean }): AiHealth {
  const enabled = opts?.enabled ?? true;
  const { data, error } = trpc.ai.healthCheck.useQuery(undefined, {
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    refetchOnWindowFocus: true,
    staleTime: POLL_INTERVAL_MS,
  });

  if (error || !data) {
    return { available: false, lastChecked: null };
  }
  return { available: data.available, lastChecked: data.lastChecked };
}
