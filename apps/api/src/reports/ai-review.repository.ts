import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type AiReviewJob,
  type AiReviewQueueRepository,
  type DuplicateComparisonResult,
  type ReportFingerprint,
  type ReportTriageResult,
  triageCandidateInputSchema,
  triageReportInputSchema,
  type TriageCandidateInput,
} from '@bug-bounty-escrow/ai';
import {
  reportAiReviewSchema,
  type ReportAiReview,
  type RequestPrincipal,
} from '@bug-bounty-escrow/shared';
import { randomUUID } from 'node:crypto';

import { normalizeDatabaseError } from '../database/database-error.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';

const MAX_ATTEMPTS = 5;
const RETRYABLE_CODES = new Set(['timeout', 'rate_limited', 'upstream_unavailable']);

interface QueueRow {
  readonly id: string;
  readonly report_id: string;
  readonly program_id: string;
  readonly revision_id: string;
  readonly submission_revision: number;
  readonly program_submission_sequence: number;
  readonly source_content_hash: string;
  readonly status: string;
  readonly attempt_count: number;
  readonly locked_by: string | null;
  readonly provider: string | null;
  readonly model: string | null;
  readonly fingerprint: unknown;
  readonly fingerprint_schema_version: number | null;
  readonly error_code: string | null;
  readonly persisted_at: string | null;
  readonly generated_at: string | null;
}

interface ResultRow {
  readonly result: unknown;
  readonly provider: string;
  readonly model: string;
  readonly schema_version: number;
  readonly source_submission_revision: number | null;
  readonly source_content_hash: string | null;
  readonly generated_at: string | null;
  readonly persisted_at: string | null;
}

export interface AiReviewReadRepository {
  getReview(reportId: string, principal: RequestPrincipal): Promise<ReportAiReview | undefined>;
}

interface SnapshotRow {
  readonly snapshot: Record<string, unknown>;
}

interface ScopeRow {
  readonly asset_type: string;
  readonly asset_name: string;
  readonly contract_address: string | null;
}

interface CandidateRow {
  readonly report_id: string;
  readonly program_submission_sequence: number;
  readonly snapshot: Record<string, unknown>;
  readonly fingerprint: unknown;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function snapshotValue(snapshot: Record<string, unknown>, key: string): unknown {
  return snapshot[key];
}

@Injectable()
export class SupabaseAiReviewQueueRepository
  implements AiReviewQueueRepository, AiReviewReadRepository
{
  private readonly workerId = `api:${randomUUID()}`;
  private providerName = 'mock';
  private providerModel = 'configured';

  public constructor(@Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient) {}

  public configureProvider(name: string, model: string): void {
    this.providerName = name;
    this.providerModel = model;
  }

  public async getReview(
    reportId: string,
    principal: RequestPrincipal,
  ): Promise<ReportAiReview | undefined> {
    const { data: currentData, error: currentError } = await this.client
      .from('reports')
      .select('content_hash')
      .eq('id', reportId)
      .maybeSingle();
    if (currentError !== null) throw normalizeDatabaseError(currentError);
    const currentHash = (currentData as { content_hash?: unknown } | null)?.content_hash;
    if (typeof currentHash !== 'string') return undefined;
    const { data: revisionData, error: revisionError } = await this.client
      .from('report_revisions')
      .select('revision,content_hash')
      .eq('report_id', reportId)
      .order('revision', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (revisionError !== null) throw normalizeDatabaseError(revisionError);
    const currentRevision = revisionData as {
      revision?: unknown;
      content_hash?: unknown;
    } | null;
    if (
      currentRevision === null ||
      typeof currentRevision.revision !== 'number' ||
      typeof currentRevision.content_hash !== 'string'
    ) {
      return undefined;
    }
    const { data: runData, error: runError } = await this.client
      .from('ai_triage_runs')
      .select(
        'id,status,provider,model,submission_revision,program_submission_sequence,source_content_hash,fingerprint,fingerprint_schema_version,error_code,persisted_at,generated_at',
      )
      .eq('report_id', reportId)
      .order('submission_revision', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (runError !== null) throw normalizeDatabaseError(runError);
    const run = runData as unknown as QueueRow | null;
    if (run === null) return undefined;
    // A report edit/resubmission changes content_hash; never display a result for an older
    // immutable revision while the new run is still queued.
    if (
      run.source_content_hash !== currentHash ||
      run.source_content_hash !== currentRevision.content_hash ||
      run.submission_revision !== currentRevision.revision
    ) {
      return undefined;
    }
    const base = {
      status:
        run.status === 'completed'
          ? ('ready' as const)
          : run.status === 'queued' || run.status === 'running'
            ? ('processing' as const)
            : ('unavailable' as const),
      ...(run.provider === null ? {} : { provider: run.provider }),
      ...(run.model === null ? {} : { model: run.model }),
      ...(run.fingerprint_schema_version === null
        ? {}
        : { schemaVersion: run.fingerprint_schema_version }),
      submissionRevision: run.submission_revision,
      submissionSequence: run.program_submission_sequence,
      sourceContentHash: run.source_content_hash,
      ...(run.generated_at === null ? {} : { generatedAt: run.generated_at }),
      ...(run.persisted_at === null ? {} : { persistedAt: run.persisted_at }),
      ...(run.error_code === null ? {} : { errorCode: run.error_code }),
      ...(principal.role === 'researcher' ||
      run.fingerprint === null ||
      run.fingerprint === undefined
        ? {}
        : { fingerprint: run.fingerprint }),
    };
    if (run.status !== 'completed') return reportAiReviewSchema.parse(base);

    const { data: resultData, error: resultError } = await this.client
      .from('ai_triage_results')
      .select(
        'result,provider,model,schema_version,source_submission_revision,source_content_hash,generated_at,persisted_at',
      )
      .eq('run_id', run.id)
      .maybeSingle();
    if (resultError !== null) throw normalizeDatabaseError(resultError);
    const result = resultData as unknown as ResultRow | null;
    if (result === null || typeof result.result !== 'object' || result.result === null) {
      return reportAiReviewSchema.parse({
        ...base,
        status: 'unavailable',
        errorCode: 'result_missing',
      });
    }
    const raw = result.result as Record<string, unknown>;
    const review = {
      ...base,
      status: 'ready' as const,
      provider: result.provider,
      model: result.model,
      schemaVersion: result.schema_version,
      ...(result.source_submission_revision === null
        ? {}
        : { submissionRevision: result.source_submission_revision }),
      ...(result.source_content_hash === null
        ? {}
        : { sourceContentHash: result.source_content_hash }),
      ...(result.generated_at === null ? {} : { generatedAt: result.generated_at }),
      ...(result.persisted_at === null ? {} : { persistedAt: result.persisted_at }),
      ...(typeof raw['summary'] === 'string' ? { summary: raw['summary'] } : {}),
      ...(typeof raw['completenessScore'] === 'number'
        ? { completenessScore: raw['completenessScore'] }
        : {}),
      ...(typeof raw['suggestedSeverity'] === 'string'
        ? { suggestedSeverity: raw['suggestedSeverity'] }
        : {}),
      ...(typeof raw['scopeAssessment'] === 'string'
        ? { scopeAssessment: raw['scopeAssessment'] }
        : {}),
      ...(Array.isArray(raw['missingInformation'])
        ? { missingInformation: raw['missingInformation'] }
        : {}),
      ...(typeof raw['confidence'] === 'number' ? { confidence: raw['confidence'] } : {}),
      ...(typeof raw['duplicateAssessment'] === 'string'
        ? { duplicateAssessment: raw['duplicateAssessment'] }
        : {}),
      ...(typeof raw['duplicateConfidence'] === 'number'
        ? { duplicateConfidence: raw['duplicateConfidence'] }
        : {}),
      ...(principal.role === 'researcher' || !Array.isArray(raw['duplicateCandidates'])
        ? {}
        : { duplicateCandidates: raw['duplicateCandidates'] }),
    };
    const parsed = reportAiReviewSchema.safeParse(review);
    return parsed.success
      ? parsed.data
      : reportAiReviewSchema.parse({
          ...base,
          status: 'unavailable',
          errorCode: 'invalid_persisted_result',
        });
  }

  public async claimNext(): Promise<AiReviewJob | null> {
    const { data, error } = await this.client.rpc('claim_ai_triage_run', {
      worker_id: this.workerId,
      lease_seconds: 300,
    });
    if (error !== null) throw normalizeDatabaseError(error);

    const row = ((data ?? []) as unknown as QueueRow[])[0];
    if (row === undefined) return null;
    const report = await this.readReportInput(row.revision_id);
    return {
      id: row.id,
      reportId: row.report_id,
      programId: row.program_id,
      submissionRevision: row.submission_revision,
      submissionSequence: row.program_submission_sequence,
      contentHash: row.source_content_hash,
      // The built-in mock never leaves the process, so it is safe for local/demo rows. Hosted
      // providers remain fail-closed unless a future queue writer explicitly marks data synthetic.
      syntheticData: this.providerName === 'mock',
      attemptCount: row.attempt_count,
      ...(row.locked_by === null ? {} : { lockToken: row.locked_by }),
      report,
    };
  }

  public async findPriorCandidates(
    job: AiReviewJob,
    fingerprint: ReportFingerprint,
  ): Promise<readonly TriageCandidateInput[]> {
    void fingerprint;
    const { data, error } = await this.client.rpc('list_ai_duplicate_candidates', {
      target_run_id: job.id,
      max_candidates: 10,
    });
    if (error !== null) throw normalizeDatabaseError(error);

    const rows = (data ?? []) as unknown as CandidateRow[];
    const result: TriageCandidateInput[] = [];
    for (const row of rows) {
      const scope = await this.readScope(row.snapshot);
      const candidate = triageCandidateInputSchema.safeParse({
        reportId: row.report_id,
        submissionSequence: row.program_submission_sequence,
        ...this.snapshotToInput(row.snapshot, scope),
        ...(row.fingerprint === null || row.fingerprint === undefined
          ? {}
          : { fingerprint: row.fingerprint }),
      });
      if (candidate.success) result.push(candidate.data);
    }
    return result;
  }

  public async persistFingerprint(job: AiReviewJob, result: ReportTriageResult): Promise<void> {
    const update = this.client
      .from('ai_triage_runs')
      .update({
        fingerprint: result.fingerprint,
        fingerprint_schema_version: result.schemaVersion,
        provider: this.providerName,
        model: this.providerModel,
        generated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'running');
    if (job.lockToken !== undefined) update.eq('locked_by', job.lockToken);
    const { data, error } = await update.select('id').maybeSingle();
    if (error !== null) throw normalizeDatabaseError(error);
    if (data === null) throw new Error('ai_run_lease_lost');
  }

  public async persistReady(
    job: AiReviewJob,
    result: ReportTriageResult,
    comparison: DuplicateComparisonResult,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error: insertError } = await this.client.from('ai_triage_results').insert({
      report_id: job.reportId,
      run_id: job.id,
      provider: this.providerName,
      model: this.providerModel,
      schema_version: result.schemaVersion,
      source_submission_revision: job.submissionRevision,
      source_content_hash: job.contentHash,
      generated_at: now,
      persisted_at: now,
      result: {
        ...result,
        duplicateAssessment: comparison.duplicateAssessment,
        duplicateConfidence: comparison.duplicateConfidence,
        duplicateCandidates: comparison.candidates,
      },
      confidence: result.confidence,
    });
    if (insertError !== null) throw normalizeDatabaseError(insertError);

    await this.finish(job, {
      status: 'completed',
      comparison_schema_version: comparison.schemaVersion,
      candidate_retrieval_version: 1,
      finished_at: now,
      persisted_at: now,
      generated_at: now,
      error_code: null,
      error_message: null,
    });
  }

  public async persistUnavailable(job: AiReviewJob, code: string): Promise<void> {
    const retryable =
      RETRYABLE_CODES.has(code) && (job.attemptCount ?? MAX_ATTEMPTS) < MAX_ATTEMPTS;
    const status = retryable ? 'queued' : 'failed';
    const now = new Date().toISOString();
    const retryAt = new Date(Date.now() + 1_000).toISOString();
    await this.finish(job, {
      status,
      // claim_ai_triage_run gates on available_at; keep both scheduling columns aligned.
      ...(retryable ? { next_attempt_at: retryAt, available_at: retryAt } : {}),
      ...(retryable ? {} : { finished_at: now }),
      error_code: code,
      error_message: 'AI provider unavailable; human review remains available.',
      persisted_at: now,
    });
  }

  private async finish(job: AiReviewJob, patch: Record<string, unknown>): Promise<void> {
    let update = this.client
      .from('ai_triage_runs')
      .update(patch)
      .eq('id', job.id)
      .eq('status', 'running');
    if (job.lockToken !== undefined) update = update.eq('locked_by', job.lockToken);
    const { data, error } = await update.select('id').maybeSingle();
    if (error !== null) throw normalizeDatabaseError(error);
    if (data === null) throw new Error('ai_run_lease_lost');
  }

  private async readReportInput(revisionId: string) {
    const { data, error } = await this.client
      .from('report_revisions')
      .select('snapshot')
      .eq('id', revisionId)
      .maybeSingle();
    if (error !== null) throw normalizeDatabaseError(error);
    const snapshot = (data as unknown as SnapshotRow | null)?.snapshot;
    if (snapshot === undefined) throw new Error('AI revision snapshot is missing');
    const scope = await this.readScope(snapshot);
    return triageReportInputSchema.parse(this.snapshotToInput(snapshot, scope));
  }

  private async readScope(snapshot: Record<string, unknown>): Promise<ScopeRow | null> {
    const affectedScopeId = snapshotValue(snapshot, 'affectedScopeId');
    if (typeof affectedScopeId !== 'string') return null;
    const { data, error } = await this.client
      .from('program_scopes')
      .select('asset_type,asset_name,contract_address')
      .eq('id', affectedScopeId)
      .maybeSingle();
    if (error !== null) throw normalizeDatabaseError(error);
    return data as unknown as ScopeRow | null;
  }

  private snapshotToInput(snapshot: Record<string, unknown>, scope: ScopeRow | null) {
    const impacts = [
      ...(Array.isArray(snapshotValue(snapshot, 'programImpactIds'))
        ? (snapshotValue(snapshot, 'programImpactIds') as unknown[])
        : []),
      ...(Array.isArray(snapshotValue(snapshot, 'customImpacts'))
        ? (snapshotValue(snapshot, 'customImpacts') as unknown[])
        : []),
    ].filter((value): value is string => typeof value === 'string');
    return {
      title: text(snapshotValue(snapshot, 'title'), 'Untitled report'),
      description: text(snapshotValue(snapshot, 'description'), 'No description provided'),
      ...(typeof snapshotValue(snapshot, 'reproductionSteps') === 'string'
        ? { reproductionSteps: snapshotValue(snapshot, 'reproductionSteps') }
        : {}),
      affectedScope: {
        assetType: scope?.asset_type ?? 'unknown',
        name:
          scope?.asset_name ?? text(snapshotValue(snapshot, 'affectedScopeId'), 'unknown scope'),
        ...(scope?.contract_address === null || scope?.contract_address === undefined
          ? {}
          : { contractAddress: scope.contract_address }),
      },
      selectedImpacts: impacts,
      proposedSeverity: text(snapshotValue(snapshot, 'proposedSeverity'), 'informational'),
    };
  }
}

/**
 * Small injectable façade used by report submission. The database RPC enqueues atomically; this
 * method is intentionally best-effort so a provider/worker outage never rolls back a submitted
 * report. Existing tests can omit the optional dependency.
 */
@Injectable()
export class AiReviewEnqueuer {
  public constructor(@Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient) {}

  public async enqueue(reportId: string, programId: string, contentHash: string): Promise<void> {
    const { error } = await this.client.rpc('enqueue_report_ai_run_atomic', {
      target_report_id: reportId,
      target_program_id: programId,
      generated_content_hash: contentHash,
    });
    if (error !== null) throw normalizeDatabaseError(error);
  }
}
