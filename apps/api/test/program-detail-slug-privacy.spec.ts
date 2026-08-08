import type { SupabaseClient } from '@supabase/supabase-js';
import type { RequestPrincipal } from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import type { ProgramDetailRow } from '../src/programs/program.mapper.js';
import { ProgramRepository } from '../src/programs/program.repository.js';

const PROGRAM_ID = '31000000-0000-4000-8000-000000000001';
const OWNER_ID = '30000000-0000-4000-8000-000000000001';
const REVIEWER_ID = '30000000-0000-4000-8000-000000000002';

function row(publicStatus: ProgramDetailRow['public_status']): ProgramDetailRow {
  return {
    id: PROGRAM_ID,
    owner_id: OWNER_ID,
    name: 'Aegis Protocol',
    slug: 'aegis-protocol',
    short_summary: 'Aegis summary',
    status: publicStatus === null ? 'draft' : 'active',
    public_status: publicStatus,
    logo_storage_path: null,
    total_pool: '100000',
    reserved_pool: '1000',
    paid_pool: '5000',
    available_pool: '94000',
    paid_report_count: 2,
    total_paid_visibility: 'private',
    max_bounty: '50000',
    in_scope_asset_types: ['smart_contract'],
    reward_severities: ['critical'],
    deadline: null,
    published_at: publicStatus === null ? null : '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-28T00:00:00.000Z',
    program_tags: [{ label: 'DeFi' }],
    description: 'Aegis description',
    website_url: 'https://aegis.example.test',
    contract_address: null,
    created_at: '2026-06-01T00:00:00.000Z',
    poc_policy: 'required',
    poc_policy_note: null,
    reward_policy: null,
    testing_restrictions: null,
    submission_acknowledgment: null,
    allow_custom_impact: true,
    program_scopes: [],
    program_impacts: [],
    program_reward_tiers: [],
    program_resources: [],
    program_prohibited_activities: [],
  };
}

function repositoryFor(program: ProgramDetailRow, reviewerAssigned = false) {
  const slugEq = vi.fn();
  const reviewerProgramEq = vi.fn();
  let requiredOwnerId: string | undefined;

  const client = {
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: string) => {
          if (table === 'programs' && column === 'slug') slugEq(value);
          if (table === 'programs' && column === 'owner_id') requiredOwnerId = value;
          if (table === 'program_reviewers' && column === 'program_id') reviewerProgramEq(value);
          return query;
        }),
        maybeSingle: vi.fn(async () => ({
          data:
            table === 'programs'
              ? requiredOwnerId === undefined || requiredOwnerId === program.owner_id
                ? program
                : null
              : reviewerAssigned
                ? { program_id: PROGRAM_ID }
                : null,
          error: null,
        })),
      };
      return query;
    }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as SupabaseClient;

  return {
    repository: new ProgramRepository(client),
    reviewerProgramEq,
    slugEq,
  };
}

describe('program detail slug privacy', () => {
  it('does not expose a draft to anonymous or unrelated principals', async () => {
    const anonymous = repositoryFor(row(null));
    await expect(anonymous.repository.findAccessibleBySlug('aegis-protocol')).resolves.toBeNull();

    const unrelated = repositoryFor(row(null));
    await expect(
      unrelated.repository.findAccessibleBySlug('aegis-protocol', {
        userId: REVIEWER_ID,
        email: 'researcher@example.test',
        role: 'researcher',
      }),
    ).resolves.toBeNull();

    expect(anonymous.slugEq).toHaveBeenCalledWith('aegis-protocol');
  });

  it('lets the owner read their draft and reveals private aggregate fields', async () => {
    const { repository } = repositoryFor(row(null));
    const detail = await repository.findAccessibleBySlug('aegis-protocol', {
      userId: OWNER_ID,
      email: 'owner@example.test',
      role: 'owner',
    });

    expect(detail).toMatchObject({
      id: PROGRAM_ID,
      slug: 'aegis-protocol',
      totalPaid: '5000',
      paidReportCount: 2,
    });
  });

  it('projects only a confirmed canonical escrow address for owner funding gates', async () => {
    const canonicalAddress = '0x2222222222222222222222222222222222222222';
    const source = row(null);
    const { repository } = repositoryFor({
      ...source,
      // The legacy programs.contract_address remains null; funding must use this projection.
      escrow_contracts: [
        {
          chain_id: 5_042_002,
          deployment_status: 'confirmed',
          contract_address: canonicalAddress,
          token_address: '0x3600000000000000000000000000000000000000',
          contract_version: '1.1.0',
        },
      ],
    });

    await expect(
      repository.findOwned(PROGRAM_ID, {
        userId: OWNER_ID,
        email: 'owner@example.test',
        role: 'owner',
      }),
    ).resolves.toMatchObject({ escrowAddress: canonicalAddress });
  });

  it('does not project pending or wrong-chain escrow rows as fundable', async () => {
    const source = row(null);
    const { repository } = repositoryFor({
      ...source,
      escrow_contracts: [
        {
          chain_id: 5_042_003,
          deployment_status: 'pending',
          contract_address: '0x3333333333333333333333333333333333333333',
          token_address: '0x3600000000000000000000000000000000000000',
          contract_version: '1.1.0',
        },
      ],
    });

    const detail = await repository.findOwned(PROGRAM_ID, {
      userId: OWNER_ID,
      email: 'owner@example.test',
      role: 'owner',
    });
    expect(detail).not.toHaveProperty('escrowAddress');
  });

  it('checks reviewer assignment with the resolved program id, not the slug', async () => {
    const { repository, reviewerProgramEq } = repositoryFor(row(null), true);
    const reviewer: RequestPrincipal = {
      userId: REVIEWER_ID,
      email: 'reviewer@example.test',
      role: 'reviewer',
    };

    await expect(
      repository.findAccessibleBySlug('aegis-protocol', reviewer),
    ).resolves.toMatchObject({
      id: PROGRAM_ID,
      slug: 'aegis-protocol',
    });
    expect(reviewerProgramEq).toHaveBeenCalledWith(PROGRAM_ID);
  });

  it('keeps a published program readable anonymously while hiding private totals', async () => {
    const { repository } = repositoryFor(row('active'));
    const detail = await repository.findAccessibleBySlug('aegis-protocol');

    expect(detail).toMatchObject({
      id: PROGRAM_ID,
      slug: 'aegis-protocol',
      totalPaid: null,
      paidReportCount: null,
    });
  });

  it.each([null, 'active'] as const)(
    'does not let another owner read a %s program through the owner endpoint repository path',
    async (publicStatus) => {
      const { repository } = repositoryFor(row(publicStatus));
      const otherOwner: RequestPrincipal = {
        userId: '30000000-0000-4000-8000-000000000099',
        email: 'other-owner@example.test',
        role: 'owner',
      };

      await expect(repository.findOwned(PROGRAM_ID, otherOwner)).resolves.toBeNull();
    },
  );

  it('returns an owner-scoped detail when the UUID and owner both match', async () => {
    const { repository } = repositoryFor(row(null));
    const owner: RequestPrincipal = {
      userId: OWNER_ID,
      email: 'owner@example.test',
      role: 'owner',
    };

    await expect(repository.findOwned(PROGRAM_ID, owner)).resolves.toMatchObject({
      id: PROGRAM_ID,
      ownerId: OWNER_ID,
      slug: 'aegis-protocol',
    });
  });
});
