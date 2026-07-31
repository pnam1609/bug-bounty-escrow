import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApproveRewardRequest,
  AttachmentUploadRequest,
  ConfirmPaymentRequest,
  CreateReportRequest,
  DisclosureDecisionRequest,
  MarkDuplicateRequest,
  PublicDisclosure,
  RejectReportRequest,
  ReportDetail,
  ReportPaidSettlementProof,
  ReportImpact,
  ReportListQuery,
  ReportProgramFilterOption,
  ReportSummary,
  RequestInformationRequest,
  RequestPrincipal,
  StartPaymentRequest,
  UpdateReportRequest,
  ValidateReportRequest,
} from '@bug-bounty-escrow/shared';
import { randomUUID } from 'node:crypto';

import { normalizeDatabaseError } from '../database/database-error.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';

interface ReportRow {
  readonly id: string;
  readonly program_id: string;
  readonly researcher_id: string;
  readonly affected_scope_id: string;
  readonly title: string;
  readonly description: string;
  readonly reproduction_steps: string | null;
  readonly secret_gist_url: string | null;
  readonly severity_mismatch_acknowledged: boolean;
  readonly proposed_severity: ReportSummary['proposedSeverity'];
  readonly final_severity: ReportSummary['finalSeverity'] | null;
  readonly status: ReportSummary['status'];
  readonly content_hash: string;
  readonly approved_reward: string | number | null;
  readonly submitted_at: string | null;
  readonly paid_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly programs: { name: string; slug: string; status: string } | null;
  readonly affected_scope: {
    id: string;
    asset_type: ReportImpact['assetType'];
    asset_name: string;
    asset_url: string | null;
    contract_address: string | null;
  } | null;
  readonly report_impacts?: Array<{
    id: string;
    program_impact_id: string | null;
    source: ReportImpact['source'];
    custom_title: string | null;
    impact_title_snapshot: string;
    impact_severity_snapshot: ReportImpact['severity'] | null;
    asset_type_snapshot: ReportImpact['assetType'];
  }>;
  readonly report_attachments?: Array<{
    id: string;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    created_at: string;
    upload_status: 'pending' | 'uploaded' | 'failed';
  }>;
  readonly report_reviews?: Array<{
    id?: string;
    reviewer_id?: string;
    action: string;
    from_status?: ReportSummary['status'];
    to_status?: ReportSummary['status'];
    reason: string | null;
    metadata?: Record<string, unknown> | null;
    created_at: string;
    reviewer?: { role: 'owner' | 'reviewer' | 'researcher' } | null;
  }>;
  readonly escrow_transactions?: Array<{
    transaction_hash: string;
    chain_id: number | string;
    token_address: string;
    amount: string | number;
    block_number: number | string | null;
    block_hash: string | null;
    confirmations: number;
    log_index: number | null;
    status: 'pending' | 'confirmed' | 'reverted' | 'timeout';
    transaction_type: string;
    confirmed_at: string | null;
  }>;
  readonly reward_settlement_intents?: Array<{
    status: string;
    amount: string | number;
    recipient_address: string;
    escrow_contracts?: { chain_id: number | string; token_address: string } | null;
    reward_settlement_operations?: Array<{
      operation_type: 'approval' | 'payout';
      status: string;
      transaction_hash: string | null;
      event_log_index: number | null;
      transfer_log_index: number | null;
      block_number: string | null;
      block_hash: string | null;
      updated_at: string;
    }>;
  }>;
}

interface ReportProgramFilterOptionRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly report_count: string | number;
}

type ReportReviewRow = NonNullable<ReportRow['report_reviews']>[number];
type InformationRequestReviewRow = ReportReviewRow & { readonly reason: string };
type ReportReviewActorRole = 'owner' | 'reviewer' | 'researcher' | 'system';
type DuplicateTargetRow = {
  readonly id: string;
  readonly title: string;
  readonly status: ReportSummary['status'];
};

const REPORT_SUMMARY_PROJECTION = [
  'id',
  'program_id',
  'researcher_id',
  'affected_scope_id',
  'title',
  'description',
  'reproduction_steps',
  'secret_gist_url',
  'severity_mismatch_acknowledged',
  'proposed_severity',
  'final_severity',
  'status',
  'content_hash',
  'approved_reward',
  'submitted_at',
  'paid_at',
  'created_at',
  'updated_at',
  // Joined so "My reports" and the review inbox can render a program name without an N+1.
  'programs(name,slug,status)',
].join(',');

const REPORT_DETAIL_PROJECTION = [
  REPORT_SUMMARY_PROJECTION,
  'affected_scope:program_scopes!reports_affected_scope_id_fkey(id,asset_type,asset_name,asset_url,contract_address)',
  'report_impacts(id,program_impact_id,source,custom_title,impact_title_snapshot,impact_severity_snapshot,asset_type_snapshot)',
  'report_attachments(id,original_filename,mime_type,size_bytes,created_at,upload_status)',
  'report_reviews(id,reviewer_id,action,from_status,to_status,reason,metadata,created_at,reviewer:profiles!report_reviews_reviewer_id_fkey(role))',
  'escrow_transactions(transaction_hash,chain_id,token_address,amount,block_number,block_hash,confirmations,log_index,status,transaction_type,confirmed_at)',
  'reward_settlement_intents(status,amount,recipient_address,escrow_contracts(chain_id,token_address),reward_settlement_operations(operation_type,status,transaction_hash,event_log_index,transfer_log_index,block_number,block_hash,updated_at))',
].join(',');

function money(value: string | number): string {
  return typeof value === 'string' ? value : value.toFixed(6);
}

function maskAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function mapReviewActorRole(review: ReportReviewRow): ReportReviewActorRole {
  // Resubmits are written by the researcher into report_reviews for chronology. Do not collapse
  // that profile role into "reviewer"; the program-side timeline needs a safe, non-identity label.
  if (review.action === 'resubmit') {
    return review.reviewer?.role === 'researcher' ? 'researcher' : 'system';
  }

  if (
    review.reviewer?.role === 'owner' ||
    review.reviewer?.role === 'reviewer'
  ) {
    return review.reviewer.role;
  }

  // A missing relation should not make the event disappear from the ordered timeline. `system`
  // is the safe fallback for malformed/legacy rows and carries no internal actor identity.
  return 'system';
}

function mapSummary(row: ReportRow): ReportSummary {
  return {
    id: row.id,
    programId: row.program_id,
    programName: row.programs?.name ?? '',
    programSlug: row.programs?.slug ?? '',
    researcherId: row.researcher_id,
    affectedScopeId: row.affected_scope_id,
    title: row.title,
    proposedSeverity: row.proposed_severity,
    ...(row.final_severity === null || row.final_severity === undefined
      ? {}
      : { finalSeverity: row.final_severity }),
    status: row.status,
    ...(row.approved_reward === null ? {} : { approvedReward: money(row.approved_reward) }),
    ...(row.submitted_at === null ? {} : { submittedAt: row.submitted_at }),
    ...(row.paid_at === null ? {} : { paidAt: row.paid_at }),
    updatedAt: row.updated_at,
  };
}

function mapDetail(
  row: ReportRow,
  principal: RequestPrincipal,
  duplicateTargets: ReadonlyMap<string, DuplicateTargetRow> = new Map(),
): ReportDetail {
  if (row.affected_scope === null) {
    throw new Error('Report affected scope relation is missing');
  }

  const latestInformationRequest = (row.report_reviews ?? [])
    .filter(
      (
        review,
      ): review is typeof review & {
        readonly reason: string;
      } => review.action === 'request_information' && review.reason !== null,
    )
    .reduce<InformationRequestReviewRow | undefined>(
      (latest, review) =>
        latest === undefined || review.created_at > latest.created_at ? review : latest,
      undefined,
    );
  const canEdit =
    principal.role === 'researcher' &&
    principal.userId === row.researcher_id &&
    row.programs?.status === 'active' &&
    (row.status === 'draft' || row.status === 'needs_information');
  const isProgramSide = principal.role === 'owner' || principal.role === 'reviewer';
  const reviewEvents = isProgramSide
    ? (row.report_reviews ?? [])
        .filter(
          (review) =>
            review.id !== undefined &&
            review.from_status !== undefined &&
            review.to_status !== undefined,
        )
        .sort(
          (left, right) =>
            left.created_at.localeCompare(right.created_at) ||
            (left.id ?? '').localeCompare(right.id ?? ''),
        )
        .map((review) => {
          const metadata = review.metadata ?? {};
          const originalReportId = metadata['originalReportId'];
          const target =
            review.action === 'mark_duplicate' && typeof originalReportId === 'string'
              ? duplicateTargets.get(originalReportId)
              : undefined;
          const duplicateTarget =
            target === undefined
              ? undefined
              : {
                  reportId: target.id,
                  sameProgram: true as const,
                  title: target.title,
                  status: target.status,
                };
          return {
            id: review.id as string,
            actorRole: mapReviewActorRole(review),
            action: review.action,
            fromStatus: review.from_status as ReportSummary['status'],
            toStatus: review.to_status as ReportSummary['status'],
            ...(review.reason === null ? {} : { reason: review.reason }),
            occurredAt: review.created_at,
            ...(duplicateTarget === undefined ? {} : { duplicateTarget }),
          };
        })
    : undefined;
  const paidIntent = isProgramSide
    ? (row.reward_settlement_intents ?? []).find((intent) => intent.status === 'paid')
    : undefined;
  const paidOperation = paidIntent?.reward_settlement_operations
    ?.filter(
      (
        operation,
      ): operation is typeof operation & {
        transaction_hash: string;
        block_number: string;
        block_hash: string;
        event_log_index: number;
        transfer_log_index: number;
      } =>
        operation.operation_type === 'payout' &&
        operation.status === 'confirmed' &&
        operation.transaction_hash !== null &&
        operation.block_number !== null &&
        operation.block_hash !== null &&
        operation.event_log_index !== null &&
        operation.transfer_log_index !== null,
    )
    .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
  const paidSettlementProof: ReportPaidSettlementProof | undefined =
    paidOperation === undefined ||
    paidIntent?.escrow_contracts === null ||
    paidIntent?.escrow_contracts === undefined
      ? undefined
      : {
          transactionHash: paidOperation.transaction_hash,
          chainId: String(paidIntent.escrow_contracts.chain_id),
          tokenAddress: paidIntent.escrow_contracts.token_address,
          recipientAddressMasked: maskAddress(paidIntent.recipient_address),
          amount: money(paidIntent.amount),
          blockNumber: paidOperation.block_number,
          blockHash: paidOperation.block_hash,
          rewardEventLogIndex: paidOperation.event_log_index,
          transferLogIndex: paidOperation.transfer_log_index,
          exactEventVerified: true,
          canonicalTransferVerified: true,
          accountingApplied: true,
          verifiedAt: paidOperation.updated_at,
        };
  return {
    ...mapSummary(row),
    description: row.description,
    ...(row.reproduction_steps === null ? {} : { reproductionSteps: row.reproduction_steps }),
    ...(row.secret_gist_url === null ? {} : { secretGistUrl: row.secret_gist_url }),
    severityMismatchAcknowledged: row.severity_mismatch_acknowledged,
    affectedScope: {
      id: row.affected_scope.id,
      assetType: row.affected_scope.asset_type,
      name: row.affected_scope.asset_name,
      ...(row.affected_scope.asset_url === null ? {} : { assetUrl: row.affected_scope.asset_url }),
      ...(row.affected_scope.contract_address === null
        ? {}
        : { contractAddress: row.affected_scope.contract_address }),
    },
    impacts: (row.report_impacts ?? []).map((impact) => ({
      id: impact.id,
      source: impact.source,
      ...(impact.program_impact_id === null ? {} : { programImpactId: impact.program_impact_id }),
      title: impact.impact_title_snapshot,
      ...(impact.impact_severity_snapshot === null
        ? {}
        : { severity: impact.impact_severity_snapshot }),
      assetType: impact.asset_type_snapshot,
    })),
    // A pending row means the signed upload never landed; surfacing it would show a file that
    // cannot be downloaded.
    attachments: (row.report_attachments ?? [])
      .filter((attachment) => attachment.upload_status === 'uploaded')
      .map((attachment) => ({
        id: attachment.id,
        filename: attachment.original_filename,
        mimeType: attachment.mime_type,
        sizeBytes: attachment.size_bytes,
        createdAt: attachment.created_at,
      })),
    capabilities: {
      canEdit,
      canResubmit: canEdit && row.status === 'needs_information',
    },
    ...(latestInformationRequest === undefined
      ? {}
      : {
          latestInformationRequest: {
            message: latestInformationRequest.reason,
            requestedAt: latestInformationRequest.created_at,
            ...(latestInformationRequest.reviewer?.role === 'owner' ||
            latestInformationRequest.reviewer?.role === 'reviewer'
              ? { authorRole: latestInformationRequest.reviewer.role }
              : {}),
          },
        }),
    ...(reviewEvents === undefined || reviewEvents.length === 0 ? {} : { reviewEvents }),
    ...(paidSettlementProof === undefined ? {} : { paidSettlementProof }),
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}

@Injectable()
export class ReportRepository {
  public constructor(@Inject(SUPABASE_CLIENT) private readonly client: SupabaseClient) {}

  public async list(
    principal: RequestPrincipal,
    query: ReportListQuery,
  ): Promise<{ reports: ReportSummary[]; total: number }> {
    let request = this.client.from('reports').select(REPORT_SUMMARY_PROJECTION, { count: 'exact' });

    if (principal.role === 'researcher') {
      request = request.eq('researcher_id', principal.userId);
    } else {
      const programIds = await this.findReviewableProgramIds(principal);

      if (programIds.length === 0) {
        return { reports: [], total: 0 };
      }
      request = request.in('program_id', programIds);
    }

    if (query.programId !== undefined) {
      request = request.eq('program_id', query.programId);
    }
    if (query.researcherId !== undefined) {
      request = request.eq('researcher_id', query.researcherId);
    }
    if (query.status !== undefined) {
      request = request.eq('status', query.status);
    }
    if (query.severity !== undefined) {
      request = request.eq('proposed_severity', query.severity);
    }

    const from = (query.page - 1) * query.limit;
    const { data, error, count } = await request
      .order('submitted_at', { ascending: false, nullsFirst: false })
      .order('id')
      .range(from, from + query.limit - 1);

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return {
      reports: (data as unknown as ReportRow[]).map(mapSummary),
      total: count ?? 0,
    };
  }

  public async listProgramFilterOptions(
    researcherId: string,
  ): Promise<ReportProgramFilterOption[]> {
    const { data, error } = await this.client.rpc('researcher_report_program_filter_options', {
      actor_id: researcherId,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return ((data ?? []) as ReportProgramFilterOptionRow[]).map((row) => {
      const reportCount = Number(row.report_count);

      if (!Number.isSafeInteger(reportCount) || reportCount < 0) {
        throw new Error('Program report count is outside the supported integer range');
      }

      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        reportCount,
      };
    });
  }

  public async findAccessible(
    principal: RequestPrincipal,
    reportId: string,
  ): Promise<ReportDetail | null> {
    const { data, error } = await this.client
      .from('reports')
      .select(REPORT_DETAIL_PROJECTION)
      .eq('id', reportId)
      .maybeSingle();

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    const row = data as unknown as ReportRow | null;

    if (row === null || !(await this.canAccessRow(principal, row))) {
      return null;
    }

    const duplicateIds = (row.report_reviews ?? [])
      .map((review) => review.metadata?.['originalReportId'])
      .filter((value): value is string => typeof value === 'string');
    const duplicateTargets =
      principal.role === 'owner' || principal.role === 'reviewer'
        ? await this.findSameProgramDuplicateTargets(row.program_id, duplicateIds)
        : new Map<string, DuplicateTargetRow>();

    return mapDetail(row, principal, duplicateTargets);
  }

  public async submit(
    researcherId: string,
    programId: string,
    input: CreateReportRequest,
    contentHash: string,
  ): Promise<string> {
    const { data, error } = await this.client.rpc('submit_report_atomic', {
      actor_id: researcherId,
      target_program_id: programId,
      input,
      generated_content_hash: contentHash,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return data as string;
  }

  public async update(
    researcherId: string,
    reportId: string,
    input: UpdateReportRequest,
    contentHash: string,
  ): Promise<void> {
    const { error } = await this.client.rpc('update_report_atomic', {
      actor_id: researcherId,
      target_report_id: reportId,
      input,
      generated_content_hash: contentHash,
      resubmit: input.resubmit,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async transition(
    functionName: string,
    parameters: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.client.rpc(functionName, parameters);

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public requestInformation(
    principal: RequestPrincipal,
    reportId: string,
    input: RequestInformationRequest,
  ): Promise<void> {
    return this.transition('request_report_information_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      transition_reason: input.reason,
    });
  }

  public validate(
    principal: RequestPrincipal,
    reportId: string,
    input: ValidateReportRequest,
  ): Promise<void> {
    return this.transition('validate_report_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      selected_severity: input.finalSeverity,
    });
  }

  public reject(
    principal: RequestPrincipal,
    reportId: string,
    input: RejectReportRequest,
  ): Promise<void> {
    return this.transition('reject_report_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      transition_reason: input.reason,
    });
  }

  public markDuplicate(
    principal: RequestPrincipal,
    reportId: string,
    input: MarkDuplicateRequest,
  ): Promise<void> {
    return this.transition('mark_report_duplicate_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      original_report_id: input.originalReportId,
      transition_reason: input.reason ?? '',
    });
  }

  public approveReward(
    principal: RequestPrincipal,
    reportId: string,
    input: ApproveRewardRequest,
  ): Promise<void> {
    // For a percentage tier the server derives the amount from the basis; `amount` is ignored.
    return this.transition('approve_report_reward_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      reward_amount: input.amount ?? null,
      calculation_basis_amount: input.calculationBasisAmount ?? null,
    });
  }

  public startPayment(
    principal: RequestPrincipal,
    reportId: string,
    input: StartPaymentRequest,
  ): Promise<void> {
    return this.transition('start_report_payment_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      payment_transaction_hash: input.transactionHash.toLowerCase(),
      payment_token_address: input.tokenAddress.toLowerCase(),
    });
  }

  public confirmPayment(
    principal: RequestPrincipal,
    reportId: string,
    input: ConfirmPaymentRequest,
  ): Promise<void> {
    return this.transition('confirm_report_payment_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      settled_block_number: input.blockNumber,
      settled_block_hash: input.blockHash.toLowerCase(),
      settled_confirmations: input.confirmations,
    });
  }

  public decideDisclosure(
    principal: RequestPrincipal,
    reportId: string,
    input: DisclosureDecisionRequest,
  ): Promise<void> {
    return this.transition('decide_report_disclosure_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      decision: input.decision,
      disclosure_title: input.publicTitle ?? null,
      disclosure_summary: input.publicSummary ?? null,
      disclosure_content: input.publicContent ?? null,
      disclosure_severity: input.publicSeverity ?? null,
    });
  }

  /**
   * Public "known issues" feed. Reads only `report_disclosures`, never joining `reports`, so a
   * mistake here cannot leak private vulnerability content.
   */
  public async listPublicDisclosures(
    programId: string,
    page: number,
    limit: number,
  ): Promise<{ disclosures: PublicDisclosure[]; total: number }> {
    const from = (page - 1) * limit;
    const { data, error, count } = await this.client
      .from('report_disclosures')
      .select(
        'id,decision,public_title,public_summary,public_content,public_severity,published_at',
        { count: 'exact' },
      )
      .eq('program_id', programId)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .order('id')
      .range(from, from + limit - 1);

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return {
      disclosures: (data ?? []).map((row) => ({
        id: row.id as string,
        decision: row.decision as PublicDisclosure['decision'],
        title: (row.public_title as string | null) ?? '',
        summary: (row.public_summary as string | null) ?? '',
        ...(row.public_content === null ? {} : { content: row.public_content as string }),
        severity: row.public_severity as PublicDisclosure['severity'],
        publishedAt: row.published_at as string,
      })),
      total: count ?? 0,
    };
  }

  public async listComments(
    principal: RequestPrincipal,
    reportId: string,
    page: number,
    limit: number,
  ) {
    if ((await this.findAccessible(principal, reportId)) === null) {
      return null;
    }

    const from = (page - 1) * limit;
    const { data, error, count } = await this.client
      .from('report_comments')
      .select('id,author_id,body,deleted_at,created_at,updated_at', {
        count: 'exact',
      })
      .eq('report_id', reportId)
      .order('created_at')
      .order('id')
      .range(from, from + limit - 1);

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return {
      comments: (data ?? []).map((comment) => ({
        id: comment.id as string,
        authorId: comment.author_id as string,
        body: comment.deleted_at === null ? (comment.body as string) : '',
        deleted: comment.deleted_at !== null,
        createdAt: comment.created_at as string,
        updatedAt: comment.updated_at as string,
      })),
      total: count ?? 0,
    };
  }

  public async addComment(
    principal: RequestPrincipal,
    reportId: string,
    body: string,
  ): Promise<string> {
    const { data, error } = await this.client.rpc('add_report_comment_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      comment_body: body,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return data as string;
  }

  /**
   * Creates or reuses a pending attachment row and signs an upload URL for it. Passing back the
   * previous `attachmentId` is how the SR-09 recovery step retries without duplicating the row.
   */
  public async createUploadUrl(
    principal: RequestPrincipal,
    reportId: string,
    input: AttachmentUploadRequest,
  ): Promise<{ attachmentId: string; uploadUrl: string }> {
    const attachmentId = input.attachmentId ?? randomUUID();
    const { data: path, error: rpcError } = await this.client.rpc(
      'prepare_report_attachment_atomic',
      {
        actor_id: principal.userId,
        target_report_id: reportId,
        attachment_id: attachmentId,
        filename: input.filename,
        media_type: input.mimeType,
        attachment_size: input.sizeBytes,
        checksum: input.checksumSha256 ?? null,
      },
    );

    if (rpcError !== null) {
      throw normalizeDatabaseError(rpcError);
    }

    const { data, error } = await this.client.storage
      .from('report-attachments')
      .createSignedUploadUrl(path as string, { upsert: true });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return { attachmentId, uploadUrl: data.signedUrl };
  }

  public async completeUpload(
    principal: RequestPrincipal,
    reportId: string,
    attachmentId: string,
  ): Promise<void> {
    const { error } = await this.client.rpc('complete_report_attachment_atomic', {
      actor_id: principal.userId,
      target_report_id: reportId,
      attachment_id: attachmentId,
    });

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }
  }

  public async createDownloadUrl(
    principal: RequestPrincipal,
    reportId: string,
    attachmentId: string,
  ): Promise<string | null> {
    if ((await this.findAccessible(principal, reportId)) === null) {
      return null;
    }

    const { data: attachment, error: attachmentError } = await this.client
      .from('report_attachments')
      .select('storage_bucket,storage_path')
      .eq('id', attachmentId)
      .eq('report_id', reportId)
      .eq('upload_status', 'uploaded')
      .maybeSingle();

    if (attachmentError !== null) {
      throw normalizeDatabaseError(attachmentError);
    }
    if (attachment === null) {
      return null;
    }

    const { data, error } = await this.client.storage
      .from(attachment.storage_bucket as string)
      .createSignedUrl(attachment.storage_path as string, 60);

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return data.signedUrl;
  }

  private async findReviewableProgramIds(principal: RequestPrincipal): Promise<string[]> {
    if (principal.role === 'owner') {
      const { data, error } = await this.client
        .from('programs')
        .select('id')
        .eq('owner_id', principal.userId);

      if (error !== null) {
        throw normalizeDatabaseError(error);
      }

      return (data ?? []).map((row) => row.id as string);
    }

    const { data, error } = await this.client
      .from('program_reviewers')
      .select('program_id')
      .eq('reviewer_id', principal.userId);

    if (error !== null) {
      throw normalizeDatabaseError(error);
    }

    return (data ?? []).map((row) => row.program_id as string);
  }

  private async canAccessRow(principal: RequestPrincipal, row: ReportRow): Promise<boolean> {
    if (principal.role === 'researcher') {
      return row.researcher_id === principal.userId;
    }

    const ids = await this.findReviewableProgramIds(principal);

    return ids.includes(row.program_id);
  }

  private async findSameProgramDuplicateTargets(
    programId: string,
    ids: readonly string[],
  ): Promise<Map<string, DuplicateTargetRow>> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return new Map();

    const { data, error } = await this.client
      .from('reports')
      .select('id,title,status')
      .eq('program_id', programId)
      .in('id', uniqueIds);
    if (error !== null) throw normalizeDatabaseError(error);

    return new Map(((data ?? []) as DuplicateTargetRow[]).map((target) => [target.id, target]));
  }
}
