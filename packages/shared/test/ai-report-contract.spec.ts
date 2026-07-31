import { describe, expect, it } from 'vitest';

import { reportAiReviewSchema, reportDetailSchema } from '../src/index.js';

describe('persisted report AI contract', () => {
  it('accepts a processing projection without a model result', () => {
    expect(reportAiReviewSchema.parse({ status: 'processing' })).toEqual({
      status: 'processing',
    });
  });

  it('accepts the reviewer result shape and bounded confidence values', () => {
    const parsed = reportAiReviewSchema.parse({
      status: 'ready',
      provider: 'mock',
      model: 'fixture-v1',
      schemaVersion: 'ai-review-v1',
      submissionRevision: 2,
      submissionSequence: 11,
      sourceContentHash: '0xabc',
      summary: 'The report describes an access-control issue.',
      completenessScore: 0.8,
      suggestedSeverity: 'high',
      scopeAssessment: 'in_scope',
      missingInformation: ['Exact failing transaction'],
      confidence: 0.9,
      duplicateAssessment: 'likely',
      duplicateConfidence: 0.95,
      duplicateCandidates: [
        {
          candidateReportId: '10000000-0000-4000-8000-000000000099',
          assessment: 'likely',
          reason: 'Same affected function and impact.',
          confidence: 0.95,
        },
      ],
      generatedAt: '2026-07-31T10:00:00.000Z',
      persistedAt: '2026-07-31T10:00:01.000Z',
    });

    expect(parsed.duplicateCandidates?.[0]?.candidateReportId).toBe(
      '10000000-0000-4000-8000-000000000099',
    );
  });

  it('rejects out-of-range confidence and unknown fields', () => {
    expect(reportAiReviewSchema.safeParse({ status: 'ready', confidence: 1.1 }).success).toBe(
      false,
    );
    expect(reportAiReviewSchema.safeParse({ status: 'ready', rawPrompt: 'secret' }).success).toBe(
      false,
    );
  });

  it('keeps AI optional for older report API projections', () => {
    const result = reportDetailSchema.safeParse({
      id: '10000000-0000-4000-8000-000000000001',
      programId: '10000000-0000-4000-8000-000000000002',
      programName: 'Aegis',
      programSlug: 'aegis',
      researcherId: '10000000-0000-4000-8000-000000000003',
      affectedScopeId: '10000000-0000-4000-8000-000000000004',
      title: 'Issue',
      description: 'Description',
      proposedSeverity: 'high',
      status: 'submitted',
      updatedAt: '2026-07-31T10:00:00.000Z',
      createdAt: '2026-07-31T10:00:00.000Z',
      severityMismatchAcknowledged: false,
      affectedScope: {
        id: '10000000-0000-4000-8000-000000000004',
        assetType: 'website',
        name: 'Aegis app',
      },
      impacts: [],
      attachments: [],
      capabilities: { canEdit: false, canResubmit: false },
      contentHash: '0xabc',
    });

    expect(result.success).toBe(true);
  });
});
