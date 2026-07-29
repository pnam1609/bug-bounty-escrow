import { describe, expect, it } from 'vitest';

import { calculateVisibleTabCount } from '../src/components/tabs.js';

describe('responsive tabs overflow', () => {
  it('keeps every tab on desktop even when the container is narrow', () => {
    expect(calculateVisibleTabCount(240, [96, 112, 88, 104, 120], 96, true)).toBe(5);
  });

  it('keeps every tab on mobile when they already fit', () => {
    expect(calculateVisibleTabCount(480, [80, 96, 72], 96, false)).toBe(3);
  });

  it('reserves room for More and overflows trailing tabs on mobile', () => {
    expect(calculateVisibleTabCount(360, [96, 112, 88, 104, 120], 96, false)).toBe(2);
  });

  it('retains one directly reachable tab at very narrow widths', () => {
    expect(calculateVisibleTabCount(120, [96, 112, 88], 96, false)).toBe(1);
  });
});
