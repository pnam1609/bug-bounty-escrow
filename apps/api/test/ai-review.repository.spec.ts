import { describe, expect, it, vi } from 'vitest';

import { SupabaseAiReviewQueueRepository } from '../src/reports/ai-review.repository.js';

const researcher = {
  userId: '10000000-0000-0000-0000-000000000001',
  email: 'researcher@example.test',
  role: 'researcher' as const,
};
const owner = { ...researcher, role: 'owner' as const };

function query(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: result, error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

function clientFor(
  currentHash: string,
  run: Record<string, unknown>,
  result: unknown,
  currentRevision = run['submission_revision'],
) {
  const reports = query({ content_hash: currentHash });
  const revisions = query({ revision: currentRevision, content_hash: currentHash });
  const runs = query(run);
  const results = query(result);
  return {
    from: vi.fn((table: string) =>
      table === 'reports'
        ? reports
        : table === 'report_revisions'
          ? revisions
          : table === 'ai_triage_runs'
            ? runs
            : results,
    ),
  };
}

const run = {
  id: '10000000-0000-0000-0000-000000000010',
  status: 'completed',
  provider: 'mock',
  model: 'mock-triage-v1',
  submission_revision: 1,
  program_submission_sequence: 1,
  source_content_hash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  fingerprint: null,
  fingerprint_schema_version: null,
  error_code: null,
  persisted_at: '2026-07-31T00:00:00.000Z',
  generated_at: '2026-07-31T00:00:00.000Z',
};

const result = {
  result: {
    summary: 'Advisory result',
    completenessScore: 0.8,
    suggestedSeverity: 'high',
    scopeAssessment: 'uncertain',
    missingInformation: [],
    confidence: 0.7,
    duplicateAssessment: 'possible',
    duplicateConfidence: 0.7,
    duplicateCandidates: [
      {
        candidateReportId: '10000000-0000-0000-0000-000000000011',
        assessment: 'possible',
        reason: 'same function',
        confidence: 0.7,
      },
    ],
  },
  provider: 'mock',
  model: 'mock-triage-v1',
  schema_version: 1,
  source_submission_revision: 1,
  source_content_hash: run.source_content_hash,
  generated_at: run.generated_at,
  persisted_at: run.persisted_at,
};

describe('SupabaseAiReviewQueueRepository report projection', () => {
  it('hides duplicate candidates from researchers while exposing the advisory result', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(run.source_content_hash, run, result) as never,
    );
    const review = await repository.getReview('10000000-0000-0000-0000-000000000020', researcher);
    expect(review?.status).toBe('ready');
    expect(review?.duplicateAssessment).toBe('possible');
    expect(review).not.toHaveProperty('duplicateCandidates');
  });

  it('returns no result when the current mutable report hash differs from the queued revision', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(
        '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        run,
        result,
      ) as never,
    );
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', owner),
    ).resolves.toBeUndefined();
  });

  it('returns no result when a same-hash resubmission has a newer revision', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(run.source_content_hash, run, result, 2) as never,
    );
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', owner),
    ).resolves.toBeUndefined();
  });
});
