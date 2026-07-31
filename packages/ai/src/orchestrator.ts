import {
  AiProviderError,
  duplicateComparisonResultSchema,
  triageCandidateInputSchema,
  triageReportInputSchema,
  type DuplicateComparisonResult,
  type ReportFingerprint,
  type ReportTriageResult,
  type TriageCandidateInput,
  type TriageProvider,
  type TriageReportInput,
} from './contracts.js';

export interface AiReviewJob {
  readonly id: string;
  readonly reportId: string;
  readonly programId: string;
  readonly submissionRevision: number;
  readonly submissionSequence: number;
  readonly contentHash: string;
  readonly syntheticData: boolean;
  readonly attemptCount?: number;
  readonly lockToken?: string;
  readonly report: TriageReportInput;
}

export interface AiReviewQueueRepository {
  /** Must atomically claim one queued row with a lease; the DB owns FIFO and per-program locking. */
  claimNext(): Promise<AiReviewJob | null>;
  /** Returns only revisions with a lower canonical sequence in the same program. */
  findPriorCandidates(
    job: AiReviewJob,
    fingerprint: ReportFingerprint,
  ): Promise<readonly TriageCandidateInput[]>;
  persistFingerprint(job: AiReviewJob, result: ReportTriageResult): Promise<void>;
  persistReady(
    job: AiReviewJob,
    result: ReportTriageResult,
    comparison: DuplicateComparisonResult,
  ): Promise<void>;
  persistUnavailable(job: AiReviewJob, code: string): Promise<void>;
}

export interface AiWorkerOptions {
  readonly privacyMode: 'demo' | 'paid';
  readonly maxCandidates?: number;
  /** Metrics are deliberately numeric/enum-only; report content never enters telemetry. */
  readonly onMetric?: (event: AiTelemetryEvent) => void;
}

export interface AiTelemetryEvent {
  readonly provider: string;
  readonly phase: 'fingerprint' | 'duplicate' | 'queue';
  readonly outcome: 'success' | 'failure' | 'disabled' | 'privacy_blocked';
  readonly durationMs: number;
  readonly errorCode?: string;
}

export interface AiRunResult {
  readonly processed: boolean;
  readonly status?: 'ready' | 'unavailable';
  readonly reportId?: string;
}

function safeFailureCode(error: unknown): string {
  if (error instanceof AiProviderError) return error.code;
  return 'provider_failure';
}

/**
 * Executes one durable queue item. Claim/lease/idempotency are intentionally delegated to the
 * queue repository, which is backed by PostgreSQL in the API. This class has no process-local
 * mutex, so multiple API replicas can safely call runOnce concurrently.
 */
export class AiReviewWorker {
  public constructor(
    private readonly queue: AiReviewQueueRepository,
    private readonly provider: TriageProvider | null,
    private readonly options: AiWorkerOptions,
  ) {}

  public async runOnce(): Promise<AiRunResult> {
    const queueStartedAt = Date.now();
    const job = await this.queue.claimNext();
    if (job === null) {
      this.emitMetric({
        provider: this.provider?.name ?? 'disabled',
        phase: 'queue',
        outcome: 'disabled',
        durationMs: Date.now() - queueStartedAt,
      });
      return { processed: false };
    }

    try {
      if (this.provider === null) {
        await this.queue.persistUnavailable(job, 'disabled');
        this.emitMetric({
          provider: 'disabled',
          phase: 'queue',
          outcome: 'disabled',
          durationMs: Date.now() - queueStartedAt,
        });
        return { processed: true, status: 'unavailable', reportId: job.reportId };
      }
      if (this.options.privacyMode === 'demo' && !job.syntheticData) {
        await this.queue.persistUnavailable(job, 'privacy_mode_demo_requires_synthetic_data');
        this.emitMetric({
          provider: this.provider.name,
          phase: 'queue',
          outcome: 'privacy_blocked',
          durationMs: Date.now() - queueStartedAt,
          errorCode: 'privacy_mode_demo_requires_synthetic_data',
        });
        return { processed: true, status: 'unavailable', reportId: job.reportId };
      }

      // Parse again at the worker boundary. Queue rows are untrusted persistence and may have
      // been written by an older API version.
      const report = triageReportInputSchema.parse(job.report);
      const fingerprintStartedAt = Date.now();
      const pass1 = await this.provider.fingerprint(report);
      this.emitMetric({
        provider: this.provider.name,
        phase: 'fingerprint',
        outcome: 'success',
        durationMs: Date.now() - fingerprintStartedAt,
      });
      await this.queue.persistFingerprint(job, pass1);

      const rawCandidates = await this.queue.findPriorCandidates(job, pass1.fingerprint);
      const candidates = rawCandidates
        .map((candidate) => triageCandidateInputSchema.parse(candidate))
        .filter((candidate) => candidate.submissionSequence < job.submissionSequence)
        .slice(0, this.options.maxCandidates ?? 10);
      const comparisonStartedAt = Date.now();
      const comparison = await this.provider.compareDuplicate(
        { ...report, fingerprint: pass1.fingerprint },
        candidates,
      );
      this.emitMetric({
        provider: this.provider.name,
        phase: 'duplicate',
        outcome: 'success',
        durationMs: Date.now() - comparisonStartedAt,
      });
      // Provider output is untrusted. Only candidate ids that came from the authorized, prior
      // sequence retrieval are allowed to reach persistence or the owner/reviewer projection.
      const allowedIds = new Set(candidates.map((candidate) => candidate.reportId));
      const safeCandidates = comparison.duplicateAssessment.candidates.filter((candidate) =>
        allowedIds.has(candidate.candidateRef),
      );
      const safeTop = safeCandidates[0];
      const safeComparison = duplicateComparisonResultSchema.parse({
        ...comparison,
        duplicateAssessment: {
          ...comparison.duplicateAssessment,
          assessment: safeTop?.assessment ?? 'none',
          confidence: safeTop?.confidence ?? 0,
          matchingReasons: safeTop?.reasons ?? [],
          candidates: safeCandidates,
        },
      });
      await this.queue.persistReady(job, pass1, safeComparison);
      return { processed: true, status: 'ready', reportId: job.reportId };
    } catch (error: unknown) {
      await this.queue.persistUnavailable(job, safeFailureCode(error));
      this.emitMetric({
        provider: this.provider?.name ?? 'disabled',
        phase: 'queue',
        outcome: 'failure',
        durationMs: Date.now() - queueStartedAt,
        errorCode: safeFailureCode(error),
      });
      return { processed: true, status: 'unavailable', reportId: job.reportId };
    }
  }

  private emitMetric(event: AiTelemetryEvent): void {
    try {
      this.options.onMetric?.(event);
    } catch {
      // Observability must never break report review or queue state transitions.
    }
  }

  public async drain(maxJobs = 100): Promise<number> {
    let processed = 0;
    while (processed < maxJobs) {
      const result = await this.runOnce();
      if (!result.processed) break;
      processed += 1;
    }
    return processed;
  }
}
