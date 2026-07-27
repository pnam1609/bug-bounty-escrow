import type { DeployEscrowRequest, Program } from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import { recordEscrowDeployment } from '@/components/owner/program-deploy';
import { ApiClientError } from '@/lib/api-client';

const INPUT: DeployEscrowRequest = {
  chainId: 5042002,
  contractAddress: '0x1111111111111111111111111111111111111111',
  transactionHash: `0x${'a'.repeat(64)}`,
};

function program(patch: Partial<Program> = {}): Program {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    ownerId: '22222222-2222-4222-8222-222222222222',
    name: 'Aegis Protocol',
    slug: 'aegis-protocol',
    shortSummary: 'Bounties for Aegis.',
    description: 'Aegis security program.',
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
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
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

describe('CP-11 escrow deployment retry', () => {
  it('returns the program from the normal record response without an extra read', async () => {
    const saved = program({
      status: 'awaiting_funding',
      contractAddress: INPUT.contractAddress.toLowerCase(),
    });
    const recordDeployment = vi.fn(async () => saved);
    const loadProgram = vi.fn(async () => saved);

    await expect(recordEscrowDeployment(INPUT, { loadProgram, recordDeployment })).resolves.toBe(
      saved,
    );
    expect(recordDeployment).toHaveBeenCalledWith(INPUT);
    expect(loadProgram).not.toHaveBeenCalled();
  });

  it('recovers a lost success response when the same escrow is already persisted', async () => {
    const duplicate = new ApiClientError(
      409,
      'program_escrow_already_deployed',
      'The request conflicts with current state',
    );
    const saved = program({
      status: 'awaiting_funding',
      contractAddress: INPUT.contractAddress.toUpperCase().replace('0X', '0x'),
    });

    await expect(
      recordEscrowDeployment(INPUT, {
        recordDeployment: vi.fn(async () => {
          throw duplicate;
        }),
        loadProgram: vi.fn(async () => saved),
      }),
    ).resolves.toBe(saved);
  });

  it('does not adopt a different existing escrow or retry a transient error automatically', async () => {
    const duplicate = new ApiClientError(
      409,
      'program_escrow_already_deployed',
      'The request conflicts with current state',
    );
    const different = program({
      status: 'awaiting_funding',
      contractAddress: '0x2222222222222222222222222222222222222222',
    });

    await expect(
      recordEscrowDeployment(INPUT, {
        recordDeployment: vi.fn(async () => {
          throw duplicate;
        }),
        loadProgram: vi.fn(async () => different),
      }),
    ).rejects.toBe(duplicate);

    const unavailable = new ApiClientError(503, 'database_unavailable', 'Temporarily unavailable');
    const loadProgram = vi.fn(async () => different);
    await expect(
      recordEscrowDeployment(INPUT, {
        recordDeployment: vi.fn(async () => {
          throw unavailable;
        }),
        loadProgram,
      }),
    ).rejects.toBe(unavailable);
    expect(loadProgram).not.toHaveBeenCalled();
  });
});
