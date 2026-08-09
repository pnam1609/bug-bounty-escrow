import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  ApproveRewardRequest,
  ConfirmPaymentRequest,
  CreateReportRequest,
  DisclosureDecisionRequest,
  GenerateAiReviewRequest,
  MarkDuplicateRequest,
  PublicDisclosureListResponse,
  RejectReportRequest,
  ReopenDuplicateRequest,
  ReportDetail,
  ReportListQuery,
  ReportListResponse,
  ReportProgramFilterOptionsResponse,
  RequestInformationRequest,
  RequestPrincipal,
  SendBackForReviewRequest,
  StartPaymentRequest,
  UpdateReportRequest,
  UpdateReportPayoutWalletRequest,
  ValidateReportRequest,
} from '@bug-bounty-escrow/shared';

import { DatabaseError } from '../database/database-error.js';
import { reportContentHash } from './report-content-hash.js';
import { ReportRepository } from './report.repository.js';
import { SupabaseAiReviewQueueRepository } from './ai-review.repository.js';

export type ReviewAction =
  'approve' | 'confirm-payment' | 'duplicate' | 'information' | 'pay' | 'reject' | 'validate';

export type ReviewInput =
  | ApproveRewardRequest
  | ConfirmPaymentRequest
  | MarkDuplicateRequest
  | RejectReportRequest
  | RequestInformationRequest
  | StartPaymentRequest
  | ValidateReportRequest;

@Injectable()
export class ReportService {
  public constructor(
    @Inject(ReportRepository) private readonly repository: ReportRepository,
    @Optional()
    @Inject(SupabaseAiReviewQueueRepository)
    private readonly aiReviewRepository?: SupabaseAiReviewQueueRepository,
  ) {}

  public async list(
    principal: RequestPrincipal,
    query: ReportListQuery,
  ): Promise<ReportListResponse> {
    const result = await this.repository.list(principal, query);
    const totalPages = result.total === 0 ? 0 : Math.ceil(result.total / query.limit);

    return {
      success: true as const,
      data: result.reports,
      metadata: {
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
        totalPages,
        hasNextPage: query.page < totalPages,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  public async listProgramFilterOptions(
    principal: RequestPrincipal,
  ): Promise<ReportProgramFilterOptionsResponse> {
    if (principal.role !== 'researcher') {
      throw new ForbiddenException();
    }

    return {
      success: true,
      data: await this.repository.listProgramFilterOptions(principal.userId),
    };
  }

  public async get(principal: RequestPrincipal, reportId: string): Promise<ReportDetail> {
    const report = await this.repository.findAccessible(principal, reportId);

    if (report === null) {
      throw new NotFoundException();
    }

    if (this.aiReviewRepository === undefined) return report;
    const aiReview = await this.aiReviewRepository.getReview(report.id, principal);
    return aiReview === undefined ? report : { ...report, aiReview };
  }

  /**
   * Requests recovery for a missing or terminal AI result. The queue RPC validates the current
   * immutable revision and is idempotent; this method never calls a provider from the request
   * path and never changes report status or any settlement decision.
   */
  public async generateAiReview(
    principal: RequestPrincipal,
    reportId: string,
    input: GenerateAiReviewRequest,
  ): Promise<ReportDetail> {
    void input;
    if (
      principal.role !== 'researcher' &&
      principal.role !== 'owner' &&
      principal.role !== 'reviewer'
    ) {
      throw new ForbiddenException();
    }

    const report = await this.repository.findAccessible(principal, reportId);
    if (report === null) throw new NotFoundException();
    if (this.aiReviewRepository === undefined) {
      throw new ServiceUnavailableException('AI review recovery is unavailable');
    }

    try {
      await this.aiReviewRepository.retryReview(report.id, report.programId, report.contentHash);
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new ServiceUnavailableException('AI review recovery is temporarily unavailable');
    }
    return this.get(principal, report.id);
  }

  public async submit(
    principal: RequestPrincipal,
    programId: string,
    input: CreateReportRequest,
  ): Promise<ReportDetail> {
    if (principal.role !== 'researcher' && principal.role !== 'owner') {
      throw new ForbiddenException();
    }

    const id = await this.repository.submit(
      principal.userId,
      programId,
      input,
      reportContentHash(input),
    );

    return this.get(principal, id);
  }

  public async update(
    principal: RequestPrincipal,
    reportId: string,
    input: UpdateReportRequest,
  ): Promise<ReportDetail> {
    if (principal.role !== 'researcher') {
      throw new ForbiddenException();
    }

    // The hash covers the post-edit state, so merge the patch onto what is currently stored
    // rather than hashing the partial payload.
    const current = await this.get(principal, reportId);
    const merged = {
      affectedScopeId: input.affectedScopeId ?? current.affectedScopeId,
      title: input.title ?? current.title,
      description: input.description ?? current.description,
      reproductionSteps: input.reproductionSteps ?? current.reproductionSteps,
      secretGistUrl:
        input.secretGistUrl === undefined
          ? current.secretGistUrl
          : (input.secretGistUrl ?? undefined),
      proposedSeverity: input.proposedSeverity ?? current.proposedSeverity,
      severityMismatchAcknowledged:
        input.severityMismatchAcknowledged ?? current.severityMismatchAcknowledged,
      programImpactIds:
        input.programImpactIds ??
        current.impacts
          .filter((impact) => impact.programImpactId !== undefined)
          .map((impact) => impact.programImpactId as string),
      customImpacts:
        input.customImpacts ??
        current.impacts
          .filter((impact) => impact.source === 'custom')
          .map((impact) => impact.title),
    };

    await this.repository.update(principal.userId, reportId, input, reportContentHash(merged));

    return this.get(principal, reportId);
  }

  public async updatePayoutWallet(
    principal: RequestPrincipal,
    reportId: string,
    input: UpdateReportPayoutWalletRequest,
  ): Promise<ReportDetail> {
    if (principal.role !== 'researcher') throw new ForbiddenException();
    await this.repository.setPayoutWallet(principal.userId, reportId, input);
    return this.get(principal, reportId);
  }

  public async review(
    action: ReviewAction,
    principal: RequestPrincipal,
    reportId: string,
    input: ReviewInput,
  ): Promise<ReportDetail> {
    if (principal.role !== 'owner' && principal.role !== 'reviewer') {
      throw new ForbiddenException();
    }

    switch (action) {
      case 'information':
        await this.repository.requestInformation(
          principal,
          reportId,
          input as RequestInformationRequest,
        );
        break;
      case 'validate':
        await this.repository.validate(principal, reportId, input as ValidateReportRequest);
        break;
      case 'reject':
        await this.repository.reject(principal, reportId, input as RejectReportRequest);
        break;
      case 'duplicate':
        await this.repository.markDuplicate(principal, reportId, input as MarkDuplicateRequest);
        break;
      case 'approve':
      case 'pay':
      case 'confirm-payment':
        throw new GoneException('reward_settlement_flow_required');
    }

    return this.get(principal, reportId);
  }

  /** Reopens a duplicate only through the owner-only, server-guarded transition. */
  public async reopenDuplicate(
    principal: RequestPrincipal,
    reportId: string,
    input: ReopenDuplicateRequest,
  ): Promise<ReportDetail> {
    if (principal.role !== 'owner') {
      throw new ForbiddenException();
    }

    await this.repository.reopenDuplicate(principal, reportId, input);
    return this.get(principal, reportId);
  }

  /** Sends a validated report back to the human review queue before settlement starts. */
  public async sendBackForReview(
    principal: RequestPrincipal,
    reportId: string,
    input: SendBackForReviewRequest,
  ): Promise<ReportDetail> {
    if (principal.role !== 'owner') {
      throw new ForbiddenException();
    }

    await this.repository.sendBackForReview(principal, reportId, input);
    return this.get(principal, reportId);
  }

  public async decideDisclosure(
    principal: RequestPrincipal,
    reportId: string,
    input: DisclosureDecisionRequest,
  ): Promise<ReportDetail> {
    if (principal.role !== 'owner') {
      throw new ForbiddenException();
    }

    await this.repository.decideDisclosure(principal, reportId, input);

    return this.get(principal, reportId);
  }

  public async listPublicDisclosures(
    programId: string,
    page: number,
    limit: number,
  ): Promise<PublicDisclosureListResponse> {
    const { disclosures, total } = await this.repository.listPublicDisclosures(
      programId,
      page,
      limit,
    );
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

    return {
      success: true,
      data: disclosures,
      metadata: {
        page,
        limit,
        totalItems: total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }
}
