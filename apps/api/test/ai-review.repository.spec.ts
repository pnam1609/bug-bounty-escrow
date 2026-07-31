import { describe, expect, it, vi } from 'vitest';

import { MockTriageProvider, triageReportInputSchema } from '@bug-bounty-escrow/ai';
import { SupabaseAiReviewQueueRepository } from '../src/reports/ai-review.repository.js';

const researcher = {
  userId: '10000000-0000-0000-0000-000000000001',
  email: 'researcher@example.test',
  role: 'researcher' as const,
};
const owner = { ...researcher, role: 'owner' as const };
const reviewer = {
  userId: '10000000-0000-0000-0000-000000000003',
  email: 'reviewer@example.test',
  role: 'reviewer' as const,
};

function query(result: unknown) {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: result, error: null }),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

function clientFor(
  currentHash: string,
  run: Record<string, unknown>,
  result: unknown,
  currentRevision = run['submission_revision'],
  accessOverrides: Record<string, unknown> = {},
  reviewerData: unknown = null,
  ownerId: string = owner.userId,
  candidateRows: unknown[] = [
    {
      id: '10000000-0000-0000-0000-000000000011',
      program_id: '10000000-0000-0000-0000-000000000099',
    },
  ],
) {
  const reports = query({
    content_hash: currentHash,
    researcher_id: researcher.userId,
    program_id: '10000000-0000-0000-0000-000000000099',
    ...accessOverrides,
  });
  const programs = query({ owner_id: ownerId });
  const reviewers = query(reviewerData);
  const candidates = query(candidateRows);
  // Candidate authorization uses a list query (no maybeSingle); resolve the terminal filter
  // directly while keeping the shared chain behavior for all other reads.
  candidates.eq.mockResolvedValue({ data: candidateRows, error: null });
  const revisions = query({ revision: currentRevision, content_hash: currentHash });
  const runs = query(run);
  const results = query(result);
  let reportReads = 0;
  return {
    from: vi.fn((table: string) =>
      table === 'reports'
        ? reportReads++ === 0
          ? reports
          : candidates
        : table === 'report_revisions'
          ? revisions
          : table === 'ai_triage_runs'
            ? runs
            : table === 'programs'
              ? programs
              : table === 'program_reviewers'
                ? reviewers
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
    completeness: {
      score: 0.8,
      checks: [{ key: 'title_and_affected_component', status: 'present', reason: 'present' }],
    },
    suggestedSeverity: { level: 'high', confidence: 0.7, rationale: 'impact' },
    scopeAssessment: { result: 'uncertain', confidence: 0.6, rationale: 'human review' },
    missingInformation: [],
    duplicateAssessment: {
      assessment: 'possible',
      confidence: 0.7,
      matchingReasons: ['same function'],
      candidates: [
        {
          candidateRef: '10000000-0000-0000-0000-000000000011',
          assessment: 'possible',
          reasons: ['same function'],
          confidence: 0.7,
        },
      ],
    },
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
    expect(review?.schemaVersion).toBe('ai-review-v1');
    expect(review?.duplicateAssessment).toBe('possible');
    expect(review).not.toHaveProperty('duplicateCandidates');
  });

  it('persists a ready result idempotently before marking the run terminal', async () => {
    const resultInsert = vi
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValue({ error: { code: '23505', message: 'duplicate run id' } });
    const finishChain = {
      update: vi.fn(),
      eq: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi
        .fn()
        .mockRejectedValueOnce(new Error('simulated_terminal_transition_crash'))
        .mockResolvedValue({ data: { id: run.id }, error: null }),
    };
    finishChain.update.mockReturnValue(finishChain);
    finishChain.eq.mockReturnValue(finishChain);
    finishChain.select.mockReturnValue(finishChain);
    const client = {
      from: vi.fn((table: string) =>
        table === 'ai_triage_results' ? { insert: resultInsert } : finishChain,
      ),
    };
    const repository = new SupabaseAiReviewQueueRepository(client as never);
    const job = {
      id: run.id,
      reportId: '10000000-0000-0000-0000-000000000020',
      programId: '10000000-0000-0000-0000-000000000099',
      submissionRevision: 1,
      submissionSequence: 1,
      contentHash: run.source_content_hash,
      syntheticData: true,
      report: triageReportInputSchema.parse({
        title: 'Issue',
        description: 'Description',
        affectedScope: { assetType: 'website', name: 'App' },
        selectedImpacts: ['data exposure'],
        proposedSeverity: 'high',
      }),
    };
    const fingerprint = await new MockTriageProvider().fingerprint(job.report);
    const comparison = await new MockTriageProvider().compareDuplicate(
      { ...job.report, fingerprint: fingerprint.fingerprint },
      [],
    );

    await expect(repository.persistReady(job, fingerprint, comparison)).rejects.toThrow(
      'simulated_terminal_transition_crash',
    );
    await repository.persistReady(job, fingerprint, comparison);

    expect(resultInsert).toHaveBeenCalledTimes(2);
    expect(resultInsert).toHaveBeenCalledWith(expect.objectContaining({ run_id: run.id }));
    expect(finishChain.update).toHaveBeenCalledTimes(2);
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
    ).resolves.toMatchObject({ status: 'superseded', errorCode: 'superseded' });
  });

  it('returns no result when a same-hash resubmission has a newer revision', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(run.source_content_hash, run, result, 2) as never,
    );
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', owner),
    ).resolves.toMatchObject({ status: 'superseded', errorCode: 'superseded' });
  });

  it('fails closed when the internal DB schema version is not mapped', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(
        run.source_content_hash,
        { ...run, fingerprint_schema_version: 2 },
        result,
      ) as never,
    );
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', owner),
    ).resolves.toMatchObject({ status: 'unavailable', errorCode: 'unsupported_schema_version' });
  });

  it('fails closed when a completed result carries an unmapped schema version', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(run.source_content_hash, run, { ...result, schema_version: 2 }) as never,
    );
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', owner),
    ).resolves.toMatchObject({ status: 'unavailable', errorCode: 'unsupported_schema_version' });
  });

  it('fails closed for a researcher who does not own the report', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(run.source_content_hash, run, result, run['submission_revision'], {
        researcher_id: '10000000-0000-0000-0000-000000000099',
      }) as never,
    );
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', researcher),
    ).resolves.toBeUndefined();
  });

  it('fails closed for an owner of a different program', async () => {
    const otherProgramClient = clientFor(run.source_content_hash, run, result) as {
      from: ReturnType<typeof vi.fn>;
    };
    const programQuery = query({ owner_id: '10000000-0000-0000-0000-000000000099' });
    otherProgramClient.from.mockImplementation((table: string) =>
      table === 'reports'
        ? query({
            content_hash: run.source_content_hash,
            researcher_id: researcher.userId,
            program_id: '10000000-0000-0000-0000-000000000099',
          })
        : table === 'programs'
          ? programQuery
          : query(null),
    );
    const repository = new SupabaseAiReviewQueueRepository(otherProgramClient as never);
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', owner),
    ).resolves.toBeUndefined();
  });

  it('allows only an assigned reviewer on the report program', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(
        run.source_content_hash,
        run,
        {
          ...result,
          result: {
            ...(result.result as Record<string, unknown>),
            duplicateAssessment: {
              ...((result.result as Record<string, unknown>)['duplicateAssessment'] as Record<
                string,
                unknown
              >),
              candidates: [],
            },
          },
        },
        run['submission_revision'],
        {},
        { reviewer_id: reviewer.userId },
        '10000000-0000-0000-0000-000000000099',
      ) as never,
    );
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', reviewer),
    ).resolves.toMatchObject({ status: 'ready' });
  });

  it('fails closed for an unassigned reviewer', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(
        run.source_content_hash,
        run,
        result,
        run['submission_revision'],
        {},
        null,
        '10000000-0000-0000-0000-000000000099',
      ) as never,
    );
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', reviewer),
    ).resolves.toBeUndefined();
  });

  it('drops persisted duplicate candidates that are no longer in the same program', async () => {
    const repository = new SupabaseAiReviewQueueRepository(
      clientFor(
        run.source_content_hash,
        run,
        result,
        run['submission_revision'],
        {},
        null,
        owner.userId,
        [],
      ) as never,
    );
    await expect(
      repository.getReview('10000000-0000-0000-0000-000000000020', owner),
    ).resolves.toMatchObject({ status: 'ready', duplicateCandidates: [] });
  });
});
