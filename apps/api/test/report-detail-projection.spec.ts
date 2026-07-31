import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ReportRepository } from '../src/reports/report.repository.js';
import { ReportService } from '../src/reports/report.service.js';

const researcher = {
  userId: '10000000-0000-4000-8000-000000000001',
  email: 'researcher@example.test',
  role: 'researcher' as const,
};

const reviewer = {
  userId: '10000000-0000-4000-8000-000000000002',
  email: 'reviewer@example.test',
  role: 'reviewer' as const,
};

function reportRow(researcherId: string = researcher.userId) {
  return {
    id: '10000000-0000-4000-8000-000000000010',
    program_id: '10000000-0000-4000-8000-000000000020',
    researcher_id: researcherId,
    affected_scope_id: '10000000-0000-4000-8000-000000000030',
    title: 'Private report',
    description: 'Private body',
    reproduction_steps: '1. Reproduce',
    secret_gist_url: null,
    severity_mismatch_acknowledged: false,
    proposed_severity: 'high',
    final_severity: null,
    status: 'needs_information',
    content_hash: '0xhash',
    approved_reward: null,
    submitted_at: '2026-07-26T10:00:00.000Z',
    paid_at: null,
    created_at: '2026-07-26T10:00:00.000Z',
    updated_at: '2026-07-26T12:00:00.000Z',
    programs: { name: 'Aegis', slug: 'aegis', status: 'active' },
    affected_scope: {
      id: '10000000-0000-4000-8000-000000000030',
      asset_type: 'smart_contract',
      asset_name: 'Aegis Vault',
      asset_url: null,
      contract_address: '0x1111111111111111111111111111111111111111',
    },
    report_impacts: [],
    report_attachments: [
      {
        id: '10000000-0000-4000-8000-000000000040',
        original_filename: 'pending.zip',
        mime_type: 'application/zip',
        size_bytes: 100,
        created_at: '2026-07-26T10:01:00.000Z',
        upload_status: 'pending',
      },
      {
        id: '10000000-0000-4000-8000-000000000041',
        original_filename: 'proof.txt',
        mime_type: 'text/plain',
        size_bytes: 50,
        created_at: '2026-07-26T10:02:00.000Z',
        upload_status: 'uploaded',
      },
    ],
    report_reviews: [
      {
        action: 'request_information',
        reason: 'Show the failing transaction.',
        created_at: '2026-07-26T11:00:00.000Z',
      },
      {
        action: 'request_information',
        reason: 'Include the exact block number.',
        created_at: '2026-07-26T12:00:00.000Z',
      },
    ],
  };
}

function repositoryFor(row: ReturnType<typeof reportRow>) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);

  return new ReportRepository({
    from: vi.fn().mockReturnValue(query),
  } as never);
}

function repositoryForReviewer(row: ReturnType<typeof reportRow>) {
  const detailQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
  };
  detailQuery.select.mockReturnValue(detailQuery);
  detailQuery.eq.mockReturnValue(detailQuery);
  const assignmentQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(resolve({ data: [{ program_id: row.program_id }], error: null })),
  };
  assignmentQuery.select.mockReturnValue(assignmentQuery);
  assignmentQuery.eq.mockReturnValue(assignmentQuery);
  const targetQuery = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve(
        resolve({
          data: [
            {
              id: '10000000-0000-4000-8000-000000000099',
              title: 'Original report',
              status: 'validated',
            },
          ],
          error: null,
        }),
      ),
  };
  targetQuery.select.mockReturnValue(targetQuery);
  targetQuery.eq.mockReturnValue(targetQuery);
  targetQuery.in.mockReturnValue(targetQuery);
  let reportReads = 0;
  return new ReportRepository({
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'program_reviewers') return assignmentQuery;
      reportReads += 1;
      return reportReads === 1 ? detailQuery : targetQuery;
    }),
  } as never);
}

describe('SR-12 private report detail projection', () => {
  it('returns the selected scope, latest information request and only uploaded attachments', async () => {
    const detail = await repositoryFor(reportRow()).findAccessible(
      researcher,
      '10000000-0000-4000-8000-000000000010',
    );

    expect(detail?.affectedScope).toEqual({
      id: '10000000-0000-4000-8000-000000000030',
      assetType: 'smart_contract',
      name: 'Aegis Vault',
      contractAddress: '0x1111111111111111111111111111111111111111',
    });
    expect(detail?.attachments.map((attachment) => attachment.filename)).toEqual(['proof.txt']);
    expect(detail?.latestInformationRequest).toEqual({
      message: 'Include the exact block number.',
      requestedAt: '2026-07-26T12:00:00.000Z',
    });
    expect(detail?.capabilities).toEqual({ canEdit: true, canResubmit: true });
  });

  it('returns the same not-found boundary for another researcher before mapping private data', async () => {
    const repository = repositoryFor(reportRow('10000000-0000-4000-8000-000000000099'));
    await expect(
      repository.findAccessible(researcher, '10000000-0000-4000-8000-000000000010'),
    ).resolves.toBeNull();

    const service = new ReportService({
      findAccessible: vi.fn().mockResolvedValue(null),
    } as never);
    await expect(
      service.get(researcher, '10000000-0000-4000-8000-000000000010'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('maps ordered human review events, same-program duplicate metadata and exact paid proof for reviewers', async () => {
    const row = reportRow();
    Object.assign(row, {
      report_reviews: [
        {
          id: '10000000-0000-4000-8000-000000000050',
          reviewer_id: reviewer.userId,
          action: 'mark_duplicate',
          from_status: 'triaged',
          to_status: 'duplicate',
          reason: 'Matches the original report',
          metadata: { originalReportId: '10000000-0000-4000-8000-000000000099' },
          created_at: '2026-07-26T13:00:00.000Z',
          reviewer: { role: 'reviewer' },
        },
        {
          id: '10000000-0000-4000-8000-000000000051',
          reviewer_id: reviewer.userId,
          action: 'request_information',
          from_status: 'submitted',
          to_status: 'needs_information',
          reason: 'Need a reproducible trace',
          metadata: {},
          created_at: '2026-07-26T14:00:00.000Z',
          reviewer: { role: 'reviewer' },
        },
      ],
    });
    Object.assign(row, {
      reward_settlement_intents: [
        {
          status: 'paid',
          amount: '250.000000',
          recipient_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          escrow_contracts: {
            chain_id: 5042002,
            token_address: '0x3600000000000000000000000000000000000000',
          },
          reward_settlement_operations: [
            {
              operation_type: 'payout',
              status: 'confirmed',
              transaction_hash: `0x${'b'.repeat(64)}`,
              event_log_index: 8,
              transfer_log_index: 9,
              block_number: '42',
              block_hash: `0x${'c'.repeat(64)}`,
              updated_at: '2026-07-26T15:00:00.000Z',
            },
          ],
        },
      ],
    });

    const detail = await repositoryForReviewer(row).findAccessible(reviewer, row.id);

    expect(detail?.latestInformationRequest?.authorRole).toBe('reviewer');
    expect(detail?.reviewEvents?.[0]).toMatchObject({
      actorRole: 'reviewer',
      action: 'mark_duplicate',
      fromStatus: 'triaged',
      toStatus: 'duplicate',
      duplicateTarget: {
        reportId: '10000000-0000-4000-8000-000000000099',
        sameProgram: true,
        title: 'Original report',
        status: 'validated',
      },
    });
    expect(detail?.paidSettlementProof).toMatchObject({
      transactionHash: `0x${'b'.repeat(64)}`,
      chainId: '5042002',
      recipientAddressMasked: '0xaaaa…aaaa',
      rewardEventLogIndex: 8,
      transferLogIndex: 9,
      exactEventVerified: true,
      canonicalTransferVerified: true,
      accountingApplied: true,
    });
  });

  it('keeps researcher resubmits chronological and never labels them as reviewer activity', async () => {
    const row = reportRow();
    Object.assign(row, {
      report_reviews: [
        {
          id: '10000000-0000-4000-8000-000000000070',
          reviewer_id: reviewer.userId,
          action: 'request_information',
          from_status: 'submitted',
          to_status: 'needs_information',
          reason: 'Please include the failing transaction.',
          metadata: {},
          created_at: '2026-07-26T13:00:00.000Z',
          reviewer: { role: 'reviewer' },
        },
        {
          id: '10000000-0000-4000-8000-000000000071',
          reviewer_id: researcher.userId,
          action: 'resubmit',
          from_status: 'needs_information',
          to_status: 'submitted',
          reason: null,
          metadata: {},
          created_at: '2026-07-26T14:00:00.000Z',
          reviewer: { role: 'researcher' },
        },
      ],
    });

    const ownerDetail = await repositoryForReviewer(row).findAccessible(reviewer, row.id);

    expect(ownerDetail?.reviewEvents).toEqual([
      expect.objectContaining({
        id: '10000000-0000-4000-8000-000000000070',
        actorRole: 'reviewer',
        action: 'request_information',
        fromStatus: 'submitted',
        toStatus: 'needs_information',
      }),
      expect.objectContaining({
        id: '10000000-0000-4000-8000-000000000071',
        actorRole: 'researcher',
        action: 'resubmit',
        fromStatus: 'needs_information',
        toStatus: 'submitted',
      }),
    ]);
    expect(ownerDetail?.reviewEvents?.[1]).not.toHaveProperty('reason');

    const researcherDetail = await repositoryFor(row).findAccessible(researcher, row.id);
    expect(researcherDetail).not.toHaveProperty('reviewEvents');
  });

  it('retains an event with a missing actor relation under the safe system role', async () => {
    const row = reportRow();
    Object.assign(row, {
      report_reviews: [
        {
          id: '10000000-0000-4000-8000-000000000072',
          reviewer_id: undefined,
          action: 'resubmit',
          from_status: 'needs_information',
          to_status: 'submitted',
          reason: null,
          metadata: {},
          created_at: '2026-07-26T14:00:00.000Z',
          reviewer: null,
        },
      ],
    });

    const detail = await repositoryForReviewer(row).findAccessible(reviewer, row.id);
    expect(detail?.reviewEvents).toEqual([
      expect.objectContaining({
        actorRole: 'system',
        action: 'resubmit',
      }),
    ]);
  });

  it('redacts internal event and settlement proof fields from the researcher projection', async () => {
    const row = reportRow();
    Object.assign(row, {
      report_reviews: [
        {
          id: '10000000-0000-4000-8000-000000000060',
          reviewer_id: reviewer.userId,
          action: 'validate',
          from_status: 'triaged',
          to_status: 'validated',
          reason: null,
          metadata: {},
          created_at: '2026-07-26T13:00:00.000Z',
          reviewer: { role: 'reviewer' },
        },
      ],
    });
    Object.assign(row, {
      reward_settlement_intents: [
        {
          status: 'paid',
          amount: '1.000000',
          recipient_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        },
      ],
    });
    const detail = await repositoryFor(row).findAccessible(researcher, row.id);
    expect(detail).not.toHaveProperty('reviewEvents');
    expect(detail).not.toHaveProperty('paidSettlementProof');
    expect(detail).not.toHaveProperty('recipientAddressMasked');
  });

  it('does not expose paid proof for stale or incomplete settlement evidence', async () => {
    const row = reportRow();
    Object.assign(row, {
      reward_settlement_intents: [
        {
          status: 'paid',
          amount: '1.000000',
          recipient_address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          escrow_contracts: {
            chain_id: 5042002,
            token_address: '0x3600000000000000000000000000000000000000',
          },
          reward_settlement_operations: [
            {
              operation_type: 'payout',
              status: 'confirmed',
              transaction_hash: `0x${'d'.repeat(64)}`,
              event_log_index: 2,
              transfer_log_index: null,
              block_number: '43',
              block_hash: `0x${'e'.repeat(64)}`,
              updated_at: '2026-07-26T16:00:00.000Z',
            },
          ],
        },
      ],
    });
    const detail = await repositoryForReviewer(row).findAccessible(reviewer, row.id);
    expect(detail).not.toHaveProperty('paidSettlementProof');
  });
});
