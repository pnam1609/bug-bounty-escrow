import type {
  EscrowTransaction,
  FundProgramRequest,
  Program,
} from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import { recordProgramFunding } from '@/components/owner/program-funding';
import { ApiClientError } from '@/lib/api-client';

const PROGRAM_ID = '11111111-1111-4111-8111-111111111111';
const INPUT: FundProgramRequest = {
  amount: '185000',
  transactionHash: `0x${'b'.repeat(64)}`,
  tokenAddress: '0x2222222222222222222222222222222222222222',
};

function program(patch: Partial<Program> = {}): Program {
  return {
    id: PROGRAM_ID,
    ownerId: '33333333-3333-4333-8333-333333333333',
    name: 'Aegis Protocol',
    slug: 'aegis-protocol',
    shortSummary: 'Bounties for Aegis.',
    description: 'Aegis security program.',
    websiteUrl: 'https://aegis.example.test',
    status: 'awaiting_funding',
    publicStatus: null,
    tags: ['DeFi'],
    totalPool: '185000',
    reservedPool: '0',
    remainingPool: '185000',
    totalPaid: null,
    totalPaidVisibility: 'private',
    paidReportCount: null,
    maxBounty: '50000',
    inScopeAssetTypes: ['smart_contract'],
    rewardSeverities: ['critical'],
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    contractAddress: '0x4444444444444444444444444444444444444444',
    scopes: [],
    impacts: [],
    rewardTiers: [],
    resources: [],
    rules: {
      pocPolicy: 'required',
      rewardPolicy: 'Rewards follow the tier.',
      allowCustomImpact: true,
      prohibitedActivities: [],
    },
    metrics: { totalAssetsInScope: 1, medianResolutionSeconds: null },
    ...patch,
  };
}

function transaction(patch: Partial<EscrowTransaction> = {}): EscrowTransaction {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    programId: PROGRAM_ID,
    chainId: 5042002,
    transactionHash: INPUT.transactionHash,
    type: 'funding',
    status: 'confirmed',
    amount: '185000.000000',
    tokenAddress: INPUT.tokenAddress.toUpperCase().replace('0X', '0x'),
    createdAt: '2026-07-27T00:00:00.000Z',
    confirmedAt: '2026-07-27T00:00:00.000Z',
    ...patch,
  };
}

describe('CP-12 reward funding response reconciliation', () => {
  it('returns a normal funding response without an extra read', async () => {
    const saved = program();
    const recordFunding = vi.fn(async () => saved);
    const loadTransaction = vi.fn(async () => transaction());
    const loadProgram = vi.fn(async () => saved);

    await expect(
      recordProgramFunding(PROGRAM_ID, INPUT, {
        loadProgram,
        loadTransaction,
        recordFunding,
      }),
    ).resolves.toBe(saved);
    expect(recordFunding).toHaveBeenCalledWith(INPUT);
    expect(loadTransaction).not.toHaveBeenCalled();
    expect(loadProgram).not.toHaveBeenCalled();
  });

  it('recovers a lost response only from the same confirmed funding event', async () => {
    const unavailable = new ApiClientError(503, 'database_unavailable', 'Temporarily unavailable');
    const saved = program();

    await expect(
      recordProgramFunding(PROGRAM_ID, INPUT, {
        recordFunding: vi.fn(async () => {
          throw unavailable;
        }),
        loadTransaction: vi.fn(async () => transaction()),
        loadProgram: vi.fn(async () => saved),
      }),
    ).resolves.toBe(saved);
  });

  it('preserves the original error for a missing or mismatched chain event', async () => {
    const unavailable = new ApiClientError(503, 'database_unavailable', 'Temporarily unavailable');
    const missing = new ApiClientError(404, 'not_found', 'Not found');
    const loadProgram = vi.fn(async () => program());

    await expect(
      recordProgramFunding(PROGRAM_ID, INPUT, {
        recordFunding: vi.fn(async () => {
          throw unavailable;
        }),
        loadTransaction: vi.fn(async () => {
          throw missing;
        }),
        loadProgram,
      }),
    ).rejects.toBe(unavailable);

    await expect(
      recordProgramFunding(PROGRAM_ID, INPUT, {
        recordFunding: vi.fn(async () => {
          throw unavailable;
        }),
        loadTransaction: vi.fn(async () =>
          transaction({ programId: '66666666-6666-4666-8666-666666666666' }),
        ),
        loadProgram,
      }),
    ).rejects.toBe(unavailable);
    expect(loadProgram).not.toHaveBeenCalled();
  });
});
