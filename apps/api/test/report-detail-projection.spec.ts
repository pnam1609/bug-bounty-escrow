import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ReportRepository } from '../src/reports/report.repository.js';
import { ReportService } from '../src/reports/report.service.js';

const researcher = {
  userId: '10000000-0000-4000-8000-000000000001',
  email: 'researcher@example.test',
  role: 'researcher' as const,
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
});
