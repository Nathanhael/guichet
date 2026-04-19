import { describe, it, expect } from 'vitest';
import { classifyImbalance } from './support.js';

describe('classifyImbalance', () => {
  it('returns ok when support/ticket ratio is at least 1:5', () => {
    expect(classifyImbalance({ online: 2, waiting: 10, oldestWaitMinutes: 3 })).toBe('ok');
    expect(classifyImbalance({ online: 1, waiting: 5, oldestWaitMinutes: 1 })).toBe('ok');
    expect(classifyImbalance({ online: 5, waiting: 0, oldestWaitMinutes: 0 })).toBe('ok');
  });

  it('returns critical when zero support and >=3 tickets waiting', () => {
    expect(classifyImbalance({ online: 0, waiting: 3, oldestWaitMinutes: 0 })).toBe('critical');
    expect(classifyImbalance({ online: 0, waiting: 20, oldestWaitMinutes: 12 })).toBe('critical');
  });

  it('returns critical when zero support and oldest > 5 minutes even with <3 waiting', () => {
    expect(classifyImbalance({ online: 0, waiting: 1, oldestWaitMinutes: 6 })).toBe('critical');
  });

  it('returns thin when zero support but <=2 waiting and oldest <=5 min', () => {
    expect(classifyImbalance({ online: 0, waiting: 2, oldestWaitMinutes: 4 })).toBe('thin');
    expect(classifyImbalance({ online: 0, waiting: 1, oldestWaitMinutes: 0 })).toBe('thin');
  });

  it('returns thin when support is severely outnumbered (>=1:10 ratio)', () => {
    expect(classifyImbalance({ online: 1, waiting: 10, oldestWaitMinutes: 2 })).toBe('thin');
    expect(classifyImbalance({ online: 2, waiting: 25, oldestWaitMinutes: 2 })).toBe('thin');
  });

  it('treats zero waiting as ok regardless of staffing', () => {
    expect(classifyImbalance({ online: 0, waiting: 0, oldestWaitMinutes: 0 })).toBe('ok');
  });
});
