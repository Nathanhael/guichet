import { router } from '../trpc.js';

export interface ImbalanceInput {
  online: number;
  waiting: number;
  oldestWaitMinutes: number;
}

export type ImbalanceLevel = 'ok' | 'thin' | 'critical';

/**
 * Heuristic from the routing spec. Critical = zero staffing AND (>=3 waiting
 * OR oldest wait exceeds 5 minutes). Thin = severely outnumbered (>=1:10) OR
 * zero staffing with a light queue still in the green window. Otherwise ok.
 */
export function classifyImbalance(input: ImbalanceInput): ImbalanceLevel {
  const { online, waiting, oldestWaitMinutes } = input;
  if (waiting === 0) return 'ok';
  if (online === 0) {
    if (waiting >= 3 || oldestWaitMinutes > 5) return 'critical';
    return 'thin';
  }
  const ratio = waiting / online;
  if (ratio >= 10) return 'thin';
  if (ratio <= 5) return 'ok';
  return 'ok';
}

export const supportRouter = router({});
