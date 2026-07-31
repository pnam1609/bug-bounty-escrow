import { describe, expect, it, vi } from 'vitest';

import {
  AiReviewWorker,
  MockTriageProvider,
  triageReportInputSchema,
  type AiReviewJob,
  type AiReviewQueueRepository,
} from '../src/index.js';

const report = triageReportInputSchema.parse({
  title: 'Synthetic issue',
  description: 'A synthetic report used to verify queue ordering and persistence.',
  reproductionSteps: 'Perform the synthetic action.',
  affectedScope: { assetType: 'smart_contract', name: 'Synthetic contract' },
  selectedImpacts: ['Synthetic impact'],
  proposedSeverity: 'medium',
});

function job(sequence: number, syntheticData = true): AiReviewJob {
  return {
    id: `20000000-0000-4000-8000-00000000000${sequence}`,
    reportId: `30000000-0000-4000-8000-00000000000${sequence}`,
    programId: '40000000-0000-4000-8000-000000000001',
    submissionRevision: 1,
    submissionSequence: sequence,
    contentHash: `0x${String(sequence).repeat(64).slice(0, 64)}`,
    syntheticData,
    report,
  };
}

function queue(jobs: AiReviewJob[]): AiReviewQueueRepository & { completed: string[] } {
  const pending = [...jobs];
  const completed: string[] = [];
  return {
    completed,
    claimNext: vi.fn(async () => pending.shift() ?? null),
    findPriorCandidates: vi.fn(async (current) =>
      jobs
        .filter((candidate) => candidate.submissionSequence < current.submissionSequence)
        .map((candidate) => ({
          reportId: candidate.reportId,
          submissionSequence: candidate.submissionSequence,
          ...candidate.report,
        })),
    ),
    persistFingerprint: vi.fn(async () => undefined),
    persistReady: vi.fn(async (current) => {
      completed.push(current.reportId);
    }),
    persistUnavailable: vi.fn(async (current) => {
      completed.push(current.reportId);
    }),
  };
}

describe('durable AI worker orchestration', () => {
  it('runs fingerprint before retrieval and comparison, preserving queue order', async () => {
    const first = job(1);
    const second = job(2);
    const repository = queue([first, second]);
    const provider = new MockTriageProvider();
    const worker = new AiReviewWorker(repository, provider, { privacyMode: 'demo' });

    await expect(worker.drain()).resolves.toBe(2);
    expect(repository.completed).toEqual([first.reportId, second.reportId]);
    expect(repository.persistFingerprint).toHaveBeenCalledTimes(2);
    expect(repository.persistReady).toHaveBeenCalledTimes(2);
    expect(repository.findPriorCandidates.mock.calls[0]?.[0].submissionSequence).toBe(1);
    expect(repository.findPriorCandidates.mock.calls[1]?.[0].submissionSequence).toBe(2);
  });

  it('fails closed for non-synthetic input in demo mode without calling the provider', async () => {
    const repository = queue([job(1, false)]);
    const provider = new MockTriageProvider();
    const fingerprint = vi.spyOn(provider, 'fingerprint');
    const worker = new AiReviewWorker(repository, provider, { privacyMode: 'demo' });

    await expect(worker.runOnce()).resolves.toMatchObject({ status: 'unavailable' });
    expect(fingerprint).not.toHaveBeenCalled();
    expect(repository.persistUnavailable).toHaveBeenCalledWith(
      expect.anything(),
      'privacy_mode_demo_requires_synthetic_data',
    );
  });

  it('continues with a safe unavailable result when provider is disabled', async () => {
    const repository = queue([job(1)]);
    const worker = new AiReviewWorker(repository, null, { privacyMode: 'demo' });

    await expect(worker.runOnce()).resolves.toMatchObject({ status: 'unavailable' });
    expect(repository.persistUnavailable).toHaveBeenCalledWith(expect.anything(), 'disabled');
  });

  it('drops provider-hallucinated candidate ids before persistence', async () => {
    const repository = queue([job(1)]);
    const provider = {
      name: 'mock' as const,
      model: 'test',
      fingerprint: vi.fn(async () => new MockTriageProvider().fingerprint(report)),
      compareDuplicate: vi.fn(async () => ({
        schemaVersion: 1,
        duplicateAssessment: 'likely' as const,
        duplicateConfidence: 0.99,
        candidates: [
          {
            candidateReportId: '10000000-0000-4000-8000-000000000099',
            assessment: 'likely' as const,
            reason: 'hallucinated',
            confidence: 0.99,
          },
        ],
      })),
    };
    const worker = new AiReviewWorker(repository, provider, { privacyMode: 'demo' });

    await worker.runOnce();
    expect(repository.persistReady).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ duplicateAssessment: 'none', candidates: [] }),
    );
  });

  it('emits numeric phase telemetry without report content', async () => {
    const repository = queue([job(1)]);
    const metrics: unknown[] = [];
    const worker = new AiReviewWorker(repository, new MockTriageProvider(), {
      privacyMode: 'demo',
      onMetric: (event) => metrics.push(event),
    });

    await worker.runOnce();
    expect(metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: 'fingerprint', outcome: 'success' }),
        expect.objectContaining({ phase: 'duplicate', outcome: 'success' }),
      ]),
    );
    expect(JSON.stringify(metrics)).not.toContain('Synthetic issue');
  });
});
