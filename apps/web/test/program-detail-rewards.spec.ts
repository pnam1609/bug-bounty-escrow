import type { Program } from '@bug-bounty-escrow/shared';
import { describe, expect, it } from 'vitest';

import { formatRewardTier } from '@/components/programs/program-format';

type RewardTier = Program['rewardTiers'][number];

/*
 * PG-DETAIL reward tiers (submit-bug flow §8): each calculation type keeps its own shape — `flat`
 * is one fixed amount, `range` is a min–max band, `percentage` is a percentage with a hard cap —
 * and every amount stays in USDC. A regression here misquotes money to a researcher deciding
 * whether to open the composer.
 */
describe('formatRewardTier', () => {
  const base = { assetType: 'smart_contract', severity: 'critical' } as const;

  const flat: RewardTier = { ...base, calculationType: 'flat', flatAmount: '50000' };
  const range: RewardTier = {
    ...base,
    calculationType: 'range',
    minReward: '1000',
    maxReward: '25000',
  };
  const percentage: RewardTier = {
    ...base,
    calculationType: 'percentage',
    percentageBps: 1000,
    maxRewardCap: '100000',
  };

  it('renders a flat tier as one fixed USDC amount', () => {
    expect(formatRewardTier(flat)).toBe('50,000 USDC');
  });

  it('renders a range tier as a min – max USDC band', () => {
    expect(formatRewardTier(range)).toBe('1,000 USDC – 25,000 USDC');
  });

  it('renders a percentage tier as a percentage with its USDC cap', () => {
    expect(formatRewardTier(percentage)).toBe(
      '10% of the verified affected funds, capped at 100,000 USDC',
    );
  });

  it('converts fractional basis points without rounding them away', () => {
    const tier: RewardTier = {
      ...base,
      calculationType: 'percentage',
      percentageBps: 250,
      maxRewardCap: '5000',
    };

    expect(formatRewardTier(tier)).toBe(
      '2.5% of the verified affected funds, capped at 5,000 USDC',
    );
  });

  it('always quotes USDC and never a converted USD figure', () => {
    for (const tier of [flat, range, percentage]) {
      const text = formatRewardTier(tier);

      expect(text).toContain('USDC');
      expect(text).not.toContain('$');
      // "USD" as a standalone unit — `USD\b` cannot match inside "USDC".
      expect(text).not.toMatch(/USD\b/);
    }
  });
});
