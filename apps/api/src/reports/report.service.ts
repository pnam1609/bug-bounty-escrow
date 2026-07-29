import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ApproveRewardRequest,
  ConfirmPaymentRequest,
  CreateReportRequest,
  DisclosureDecisionRequest,
  MarkDuplicateRequest,
  PublicDisclosureListResponse,
  RejectReportRequest,
  ReportDetail,
  ReportListQuery,
  ReportListResponse,
  ReportProgramFilterOptionsResponse,
  RequestInformationRequest,
  RequestPrincipal,
  StartPaymentRequest,
  UpdateReportRequest,
  ValidateReportRequest,
} from '@bug-bounty-escrow/shared';

import { reportContentHash } from './report-content-hash.js';
import { ReportRepository } from './report.repository.js';

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
  public constructor(@Inject(ReportRepository) private readonly repository: ReportRepository) {}

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

    return report;
  }

  public async submit(
    principal: RequestPrincipal,
    programId: string,
    input: CreateReportRequest,
  ): Promise<ReportDetail> {
    if (principal.role !== 'researcher') {
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
