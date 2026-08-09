import { afterEach, describe, expect, it, vi } from 'vitest';

import { getSiteCopyright } from '@/lib/site-footer';

describe('site footer copyright', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the year from the current date instead of a fixed year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2031, 0, 1));
    expect(getSiteCopyright()).toBe('© 2031 BountyEscrow');

    vi.setSystemTime(new Date(2032, 0, 1));
    expect(getSiteCopyright()).toBe('© 2032 BountyEscrow');
  });

  it('preserves footer-specific suffixes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2031, 0, 1));
    expect(getSiteCopyright(' · Arc Testnet')).toBe('© 2031 BountyEscrow · Arc Testnet');
  });
});
