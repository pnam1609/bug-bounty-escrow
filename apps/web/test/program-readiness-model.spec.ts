import type { Program } from '@bug-bounty-escrow/shared';
import { describe, expect, it } from 'vitest';

import { buildProgramReadiness } from '@/components/owner/program-readiness-model';

function savedDraft(): Program {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ownerId: '22222222-2222-4222-8222-222222222222',
    name: 'Aegis Protocol',
    slug: 'aegis-protocol',
    shortSummary: 'Bounties for the Aegis core contracts.',
    description: 'Long-form overview researchers read before testing.',
    websiteUrl: 'https://aegis.example.test',
    status: 'draft',
    publicStatus: null,
    tags: ['DeFi'],
    totalPool: '0',
    reservedPool: '0',
    remainingPool: '0',
    totalPaid: null,
    totalPaidVisibility: 'private',
    paidReportCount: null,
    maxBounty: '50000',
    inScopeAssetTypes: ['smart_contract'],
    rewardSeverities: ['critical'],
    deadline: '2099-07-31T00:00:00.000Z',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    scopes: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        assetType: 'smart_contract',
        assetName: 'Aegis Core',
        isInScope: true,
        sortOrder: 0,
        archived: false,
      },
    ],
    impacts: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        assetType: 'smart_contract',
        severity: 'critical',
        title: 'Direct theft of user funds',
        source: 'template',
        templateKey: 'direct_theft_of_user_funds',
        enabled: true,
        sortOrder: 0,
      },
    ],
    rewardTiers: [
      {
        assetType: 'smart_contract',
        severity: 'critical',
        calculationType: 'range',
        minReward: '10000',
        maxReward: '50000',
      },
    ],
    resources: [],
    rules: {
      pocPolicy: 'required',
      rewardPolicy: 'Rewards follow the configured tier.',
      allowCustomImpact: true,
      prohibitedActivities: [],
    },
    metrics: { totalAssetsInScope: 1, medianResolutionSeconds: null },
  };
}

describe('CP-10 draft readiness model', () => {
  it('returns the eight ticket rows with the exact initial draft statuses', () => {
    const readiness = buildProgramReadiness(savedDraft());

    expect(readiness.map(({ title }) => title)).toEqual([
      'Program details',
      'Scope',
      'Impact catalog',
      'Reward tiers',
      'Program rules',
      'Escrow contract',
      'Funding',
      'Publishing',
    ]);
    expect(readiness.map(({ status }) => status)).toEqual([
      'Complete',
      'Complete',
      'Complete',
      'Complete',
      'Complete',
      'Not deployed',
      '0 USDC available',
      'Not ready',
    ]);
  });

  it('does not treat the legacy program contract field as a confirmed escrow', () => {
    const legacyOnly: Program = {
      ...savedDraft(),
      contractAddress: '0x1111111111111111111111111111111111111111',
    };

    const escrow = buildProgramReadiness(legacyOnly).find(({ id }) => id === 'escrow-contract');
    expect(escrow).toMatchObject({ complete: false, status: 'Not deployed' });
  });

  it('requires impact and reward coverage for every in-scope asset type', () => {
    const draft = savedDraft();
    const withWebsiteScope: Program = {
      ...draft,
      inScopeAssetTypes: ['smart_contract', 'website'],
      scopes: [
        ...draft.scopes,
        {
          id: '55555555-5555-4555-8555-555555555555',
          assetType: 'website',
          assetName: 'Aegis dashboard',
          assetUrl: 'https://aegis.example.test',
          isInScope: true,
          sortOrder: 1,
          archived: false,
        },
      ],
    };

    const readiness = buildProgramReadiness(withWebsiteScope);

    expect(readiness.find(({ id }) => id === 'scope')?.status).toBe('Complete');
    expect(readiness.find(({ id }) => id === 'impact-catalog')?.status).toBe('Incomplete');
    expect(readiness.find(({ id }) => id === 'reward-tiers')?.status).toBe('Incomplete');
  });

  it('keeps publishing not ready when the deadline is missing or already elapsed', () => {
    for (const deadline of [undefined, '2020-01-01T00:00:00.000Z']) {
      const program: Program = {
        ...savedDraft(),
        ...(deadline === undefined ? { deadline: undefined } : { deadline }),
        escrowAddress: '0x1111111111111111111111111111111111111111',
        totalPool: '50000',
        remainingPool: '50000',
      };
      const readiness = buildProgramReadiness(program);
      expect(readiness.find(({ id }) => id === 'program-details')?.complete).toBe(false);
      expect(readiness.find(({ id }) => id === 'publishing')?.status).toBe('Not ready');
    }
  });

  it('keeps publishing separate and only marks it ready after escrow and funding', () => {
    const draft = savedDraft();
    const prepared: Program = {
      ...draft,
      escrowAddress: '0x1111111111111111111111111111111111111111',
      totalPool: '185000',
      remainingPool: '185000',
    };

    const readiness = buildProgramReadiness(prepared);

    expect(readiness.find(({ id }) => id === 'escrow-contract')?.status).toBe('Complete');
    expect(readiness.find(({ id }) => id === 'funding')?.status).toBe('Complete');
    expect(readiness.find(({ id }) => id === 'publishing')?.status).toBe('Ready');
    expect(readiness.find(({ id }) => id === 'publishing')?.complete).toBe(false);
  });

  it('does not advertise publish readiness when available collateral is below max bounty', () => {
    const undercollateralized: Program = {
      ...savedDraft(),
      escrowAddress: '0x1111111111111111111111111111111111111111',
      totalPool: '185000',
      reservedPool: '150000',
      remainingPool: '35000',
    };

    const readiness = buildProgramReadiness(undercollateralized);

    expect(readiness.find(({ id }) => id === 'funding')).toMatchObject({
      complete: false,
      status: '35,000 USDC available',
    });
    expect(readiness.find(({ id }) => id === 'publishing')).toMatchObject({
      complete: false,
      status: 'Not ready',
    });
  });
});
