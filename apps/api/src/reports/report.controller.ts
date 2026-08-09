import {
  Controller,
  Get,
  GoneException,
  Inject,
  Patch,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import {
  approveRewardRequestSchema,
  commentListQuerySchema,
  confirmPaymentRequestSchema,
  createReportRequestSchema,
  disclosureDecisionRequestSchema,
  generateAiReviewRequestSchema,
  markDuplicateRequestSchema,
  programIdParamsSchema,
  rejectReportRequestSchema,
  reopenDuplicateRequestSchema,
  reportIdParamsSchema,
  reportListQuerySchema,
  reportProgramFilterOptionsResponseSchema,
  requestInformationRequestSchema,
  sendBackForReviewRequestSchema,
  startPaymentRequestSchema,
  updateReportRequestSchema,
  validateReportRequestSchema,
  type ApproveRewardRequest,
  type ConfirmPaymentRequest,
  type CreateReportRequest,
  type DisclosureDecisionRequest,
  type GenerateAiReviewRequest,
  type MarkDuplicateRequest,
  type ProgramIdParams,
  type PublicDisclosureListResponse,
  type RejectReportRequest,
  type ReopenDuplicateRequest,
  type ReportListQuery,
  type ReportListResponse,
  type ReportProgramFilterOptionsResponse,
  type ReportResponse,
  type RequestInformationRequest,
  type RequestPrincipal,
  type StartPaymentRequest,
  type SendBackForReviewRequest,
  type UpdateReportRequest,
  type ValidateReportRequest,
} from '@bug-bounty-escrow/shared';

import { ApiZodResponse, ZodBody, ZodParam, ZodQuery } from '../openapi/zod-openapi.js';
import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ReportService, type ReviewAction, type ReviewInput } from './report.service.js';

function requirePrincipal(principal: RequestPrincipal | undefined): RequestPrincipal {
  if (principal === undefined) {
    throw new UnauthorizedException();
  }

  return principal;
}

@Controller('reports')
export class ReportController {
  public constructor(@Inject(ReportService) private readonly service: ReportService) {}

  @Get()
  public list(
    @ZodQuery(reportListQuerySchema)
    query: ReportListQuery,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportListResponse> {
    return this.service.list(requirePrincipal(principal), query);
  }

  @Roles('researcher')
  @Get('filter-options/programs')
  @ApiZodResponse(
    200,
    'Programs represented across all reports owned by the authenticated researcher',
    reportProgramFilterOptionsResponseSchema,
  )
  public listProgramFilterOptions(
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportProgramFilterOptionsResponse> {
    return this.service.listProgramFilterOptions(requirePrincipal(principal));
  }

  @Get(':id')
  public async get(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return {
      success: true,
      data: await this.service.get(requirePrincipal(principal), params.id),
    };
  }

  @Roles('researcher', 'owner', 'reviewer')
  @Post(':id/ai-review/generate')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  public async generateAiReview(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(generateAiReviewRequestSchema)
    input: GenerateAiReviewRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return {
      success: true,
      data: await this.service.generateAiReview(requirePrincipal(principal), params.id, input),
    };
  }

  @Roles('researcher')
  @Patch(':id')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  public async update(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(updateReportRequestSchema)
    input: UpdateReportRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return {
      success: true,
      data: await this.service.update(requirePrincipal(principal), params.id, input),
    };
  }

  @Roles('owner', 'reviewer')
  @Post(':id/request-information')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public transitionToInformation(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(requestInformationRequestSchema)
    input: RequestInformationRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return this.review('information', principal, params.id, input);
  }

  @Roles('owner', 'reviewer')
  @Post(':id/validate')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public validate(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(validateReportRequestSchema)
    input: ValidateReportRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return this.review('validate', principal, params.id, input);
  }

  @Roles('owner', 'reviewer')
  @Post(':id/reject')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public reject(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(rejectReportRequestSchema)
    input: RejectReportRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return this.review('reject', principal, params.id, input);
  }

  @Roles('owner', 'reviewer')
  @Post(':id/mark-duplicate')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public duplicate(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(markDuplicateRequestSchema)
    input: MarkDuplicateRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return this.review('duplicate', principal, params.id, input);
  }

  @Roles('owner')
  @Post(':id/reopen-duplicate')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public async reopenDuplicate(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(reopenDuplicateRequestSchema)
    input: ReopenDuplicateRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return {
      success: true,
      data: await this.service.reopenDuplicate(requirePrincipal(principal), params.id, input),
    };
  }

  @Roles('owner')
  @Post(':id/send-back-for-review')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public async sendBackForReview(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(sendBackForReviewRequestSchema)
    input: SendBackForReviewRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return {
      success: true,
      data: await this.service.sendBackForReview(requirePrincipal(principal), params.id, input),
    };
  }

  @Roles('owner', 'reviewer')
  @Post(':id/approve-reward')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  public approve(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(approveRewardRequestSchema)
    input: ApproveRewardRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    void params;
    void input;
    void principal;
    throw new GoneException('reward_settlement_flow_required');
  }

  /** Records the submitted payout transaction and moves the report to payment_pending. */
  @Roles('owner', 'reviewer')
  @Post(':id/pay')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  public pay(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(startPaymentRequestSchema)
    input: StartPaymentRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    void params;
    void input;
    void principal;
    throw new GoneException('reward_settlement_flow_required');
  }

  /** Settles the payout: moves the amount from reserved to paid and marks the report paid. */
  @Roles('owner', 'reviewer')
  @Post(':id/confirm-payment')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  public confirmPayment(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(confirmPaymentRequestSchema)
    input: ConfirmPaymentRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    void params;
    void input;
    void principal;
    throw new GoneException('reward_settlement_flow_required');
  }

  /** Owner decision on whether a resolved report becomes a public known issue. */
  @Roles('owner')
  @Post(':id/disclosure')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public async disclosure(
    @ZodParam(reportIdParamsSchema) params: ProgramIdParams,
    @ZodBody(disclosureDecisionRequestSchema)
    input: DisclosureDecisionRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return {
      success: true,
      data: await this.service.decideDisclosure(requirePrincipal(principal), params.id, input),
    };
  }

  private async review(
    action: ReviewAction,
    principal: RequestPrincipal | undefined,
    reportId: string,
    input: ReviewInput,
  ): Promise<ReportResponse> {
    return {
      success: true,
      data: await this.service.review(action, requirePrincipal(principal), reportId, input),
    };
  }
}

@Controller('programs/:id/reports')
export class ProgramReportController {
  public constructor(@Inject(ReportService) private readonly service: ReportService) {}

  @Roles('owner', 'researcher')
  @Post()
  @RateLimit({ limit: 10, windowMs: 60_000 })
  public async submit(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(createReportRequestSchema)
    input: CreateReportRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ReportResponse> {
    return {
      success: true,
      data: await this.service.submit(requirePrincipal(principal), params.id, input),
    };
  }
}

/** Known issues: published, owner-authored disclosure text only. */
@Controller('programs/:id/disclosures')
export class ProgramDisclosureController {
  public constructor(@Inject(ReportService) private readonly service: ReportService) {}

  @Public()
  @Get()
  public list(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodQuery(commentListQuerySchema)
    query: { page: number; limit: number },
  ): Promise<PublicDisclosureListResponse> {
    return this.service.listPublicDisclosures(params.id, query.page, query.limit);
  }
}
