import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  AI_SCHEMA_VERSION,
  AI_SCHEMA_VERSION_NUMBER,
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

function publicAiSchemaVersion(value: number | null | undefined): string | undefined {
  return value === AI_SCHEMA_VERSION_NUMBER ? AI_SCHEMA_VERSION : undefined;
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
    // This repository is also callable outside ReportService (for example from a worker-facing
    // adapter).  Do not rely on the caller having performed report access checks: fail closed
    // before reading revisions/results whenever the principal cannot access this report.
    const { data: accessData, error: accessError } = await this.client
      .from('reports')
      .select('content_hash,researcher_id,program_id')
      .eq('id', reportId)
      .maybeSingle();
    if (accessError !== null) throw normalizeDatabaseError(accessError);
    const access = accessData as {
      content_hash?: unknown;
      researcher_id?: unknown;
      program_id?: unknown;
    } | null;
    if (
      access === null ||
      typeof access.content_hash !== 'string' ||
      typeof access.program_id !== 'string' ||
      typeof access.researcher_id !== 'string'
    ) {
      return undefined;
    }

    let authorized = false;
    if (principal.role === 'researcher') {
      authorized = access.researcher_id === principal.userId;
    } else if (principal.role === 'owner' || principal.role === 'reviewer') {
      const { data: programData, error: programError } = await this.client
        .from('programs')
        .select('owner_id')
        .eq('id', access.program_id)
        .maybeSingle();
      if (programError !== null) throw normalizeDatabaseError(programError);
      const ownerId = (programData as { owner_id?: unknown } | null)?.owner_id;
      if (principal.role === 'owner') {
        authorized = ownerId === principal.userId;
      } else if (ownerId !== principal.userId) {
        const { data: reviewerData, error: reviewerError } = await this.client
          .from('program_reviewers')
          .select('reviewer_id')
          .eq('program_id', access.program_id)
          .eq('reviewer_id', principal.userId)
          .maybeSingle();
        if (reviewerError !== null) throw normalizeDatabaseError(reviewerError);
        authorized =
          (reviewerData as { reviewer_id?: unknown } | null)?.reviewer_id === principal.userId;
      }
    }
    if (!authorized) return undefined;

    const currentHash = access.content_hash;
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
    if (
      run.fingerprint_schema_version !== null &&
      publicAiSchemaVersion(run.fingerprint_schema_version) === undefined
    ) {
      return reportAiReviewSchema.parse({
        status: 'unavailable',
        errorCode: 'unsupported_schema_version',
      });
    }
    // A report edit/resubmission changes content_hash; never display a result for an older
    // immutable revision while the new run is still queued. Expose the explicit superseded
    // state so the UI can show a safe badge without falling back to stale AI content.
    if (
      run.source_content_hash !== currentHash ||
      run.source_content_hash !== currentRevision.content_hash ||
      run.submission_revision !== currentRevision.revision
    ) {
      return reportAiReviewSchema.parse({
        status: 'superseded',
        ...(run.provider === null ? {} : { provider: run.provider }),
        ...(run.model === null ? {} : { model: run.model }),
        ...(publicAiSchemaVersion(run.fingerprint_schema_version) === undefined
          ? {}
          : { schemaVersion: publicAiSchemaVersion(run.fingerprint_schema_version) }),
        submissionRevision: run.submission_revision,
        submissionSequence: run.program_submission_sequence,
        sourceContentHash: run.source_content_hash,
        ...(run.generated_at === null ? {} : { generatedAt: run.generated_at }),
        ...(run.persisted_at === null ? {} : { persistedAt: run.persisted_at }),
        errorCode: 'superseded',
      });
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
      ...(publicAiSchemaVersion(run.fingerprint_schema_version) === undefined
        ? {}
        : { schemaVersion: publicAiSchemaVersion(run.fingerprint_schema_version) }),
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
    if (publicAiSchemaVersion(result.schema_version) === undefined) {
      return reportAiReviewSchema.parse({
        ...base,
        status: 'unavailable',
        errorCode: 'unsupported_schema_version',
      });
    }
    const raw = result.result as Record<string, unknown>;
    const completeness = raw['completeness'];
    const suggestedSeverity = raw['suggestedSeverity'];
    const scopeAssessment = raw['scopeAssessment'];
    const duplicateAssessment = raw['duplicateAssessment'];
    const completenessScore =
      typeof completeness === 'object' &&
      completeness !== null &&
      typeof (completeness as Record<string, unknown>)['score'] === 'number'
        ? (completeness as Record<string, unknown>)['score']
        : undefined;
    const severityLevel =
      typeof suggestedSeverity === 'object' &&
      suggestedSeverity !== null &&
      typeof (suggestedSeverity as Record<string, unknown>)['level'] === 'string'
        ? (suggestedSeverity as Record<string, unknown>)['level']
        : undefined;
    const scopeResult =
      typeof scopeAssessment === 'object' &&
      scopeAssessment !== null &&
      typeof (scopeAssessment as Record<string, unknown>)['result'] === 'string'
        ? (scopeAssessment as Record<string, unknown>)['result']
        : undefined;
    const severityConfidence =
      typeof suggestedSeverity === 'object' &&
      suggestedSeverity !== null &&
      typeof (suggestedSeverity as Record<string, unknown>)['confidence'] === 'number'
        ? (suggestedSeverity as Record<string, unknown>)['confidence']
        : undefined;
    const duplicateObject =
      typeof duplicateAssessment === 'object' && duplicateAssessment !== null
        ? (duplicateAssessment as Record<string, unknown>)
        : undefined;
    const duplicateLevel =
      typeof duplicateObject?.['assessment'] === 'string'
        ? duplicateObject['assessment']
        : undefined;
    const duplicateConfidence =
      typeof duplicateObject?.['confidence'] === 'number'
        ? duplicateObject['confidence']
        : undefined;
    const duplicateCandidates = Array.isArray(duplicateObject?.['candidates'])
      ? duplicateObject['candidates']
          .map((candidate) => {
            if (typeof candidate !== 'object' || candidate === null) return undefined;
            const row = candidate as Record<string, unknown>;
            const candidateRef = row['candidateRef'];
            if (typeof candidateRef !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidateRef)) {
              return undefined;
            }
            const reasons = Array.isArray(row['reasons'])
              ? row['reasons'].filter((reason): reason is string => typeof reason === 'string')
              : [];
            return {
              candidateReportId: candidateRef,
              assessment: row['assessment'],
              reason: reasons[0] ?? 'AI matching signal',
              confidence: row['confidence'],
            };
          })
          .filter((candidate) => candidate !== undefined)
      : undefined;
    // Provider output is only a candidate suggestion. Re-authorize every referenced report at
    // read time so deleted rows, cross-program IDs, or rows no longer visible to this principal
    // cannot leak through a persisted AI result. Researchers never reach this branch.
    let visibleDuplicateCandidates = duplicateCandidates;
    if (principal.role !== 'researcher' && duplicateCandidates !== undefined) {
      const candidateIds = duplicateCandidates
        .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined)
        .map((candidate) => candidate.candidateReportId);
      if (candidateIds.length === 0) {
        visibleDuplicateCandidates = [];
      } else {
        const { data: candidateRows, error: candidateError } = await this.client
          .from('reports')
          .select('id,program_id')
          .in('id', candidateIds)
          .eq('program_id', access.program_id);
        if (candidateError !== null) throw normalizeDatabaseError(candidateError);
        const visibleIds = new Set(
          ((candidateRows ?? []) as Array<{ id?: unknown; program_id?: unknown }>).flatMap((row) =>
            row.id === undefined || row.program_id !== access.program_id ? [] : [row.id],
          ),
        );
        visibleDuplicateCandidates = duplicateCandidates.filter(
          (candidate) => candidate !== undefined && visibleIds.has(candidate.candidateReportId),
        );
      }
    }
    const review = {
      ...base,
      status: 'ready' as const,
      provider: result.provider,
      model: result.model,
      ...(publicAiSchemaVersion(result.schema_version) === undefined
        ? {}
        : { schemaVersion: publicAiSchemaVersion(result.schema_version) }),
      ...(result.source_submission_revision === null
        ? {}
        : { submissionRevision: result.source_submission_revision }),
      ...(result.source_content_hash === null
        ? {}
        : { sourceContentHash: result.source_content_hash }),
      ...(result.generated_at === null ? {} : { generatedAt: result.generated_at }),
      ...(result.persisted_at === null ? {} : { persistedAt: result.persisted_at }),
      ...(typeof raw['summary'] === 'string' ? { summary: raw['summary'] } : {}),
      ...(completenessScore === undefined ? {} : { completenessScore }),
      ...(severityLevel === undefined ? {} : { suggestedSeverity: severityLevel }),
      ...(scopeResult === undefined ? {} : { scopeAssessment: scopeResult }),
      ...(Array.isArray(raw['missingInformation'])
        ? { missingInformation: raw['missingInformation'] }
        : {}),
      ...(severityConfidence === undefined ? {} : { confidence: severityConfidence }),
      ...(duplicateLevel === undefined ? {} : { duplicateAssessment: duplicateLevel }),
      ...(duplicateConfidence === undefined ? {} : { duplicateConfidence }),
      ...(principal.role === 'researcher' || visibleDuplicateCandidates === undefined
        ? {}
        : { duplicateCandidates: visibleDuplicateCandidates }),
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
        fingerprint_schema_version: AI_SCHEMA_VERSION_NUMBER,
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
      schema_version: AI_SCHEMA_VERSION_NUMBER,
      source_submission_revision: job.submissionRevision,
      source_content_hash: job.contentHash,
      generated_at: now,
      persisted_at: now,
      result: {
        ...result,
        duplicateAssessment: comparison.duplicateAssessment,
      },
      confidence: result.suggestedSeverity.confidence,
    });
    // The unique run_id index is partial (legacy rows may have no run_id), so an ON CONFLICT
    // upsert cannot reliably infer it on every Postgres version. A duplicate is the expected
    // recovery path after a worker crash between result insert and terminal run update.
    if (insertError !== null && (insertError as { code?: unknown }).code !== '23505') {
      throw normalizeDatabaseError(insertError);
    }

    await this.finish(job, {
      status: 'completed',
      comparison_schema_version: AI_SCHEMA_VERSION_NUMBER,
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
    if (data !== null) return;

    // A retry can arrive after another worker completed the terminal transition. Treat the
    // desired terminal state as idempotent success; any other state still indicates a lost lease.
    const { data: terminalData, error: terminalError } = await this.client
      .from('ai_triage_runs')
      .select('status')
      .eq('id', job.id)
      .maybeSingle();
    if (terminalError !== null) throw normalizeDatabaseError(terminalError);
    const terminalStatus = (terminalData as { status?: unknown } | null)?.status;
    if (terminalStatus === patch['status']) return;
    throw new Error('ai_run_lease_lost');
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
