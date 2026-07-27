import { Controller, Delete, Get, Inject, Patch, Post, UnauthorizedException } from '@nestjs/common';
import {
  assignReviewerRequestSchema,
  commentListQuerySchema,
  createProgramRequestSchema,
  deployEscrowRequestSchema,
  fundProgramRequestSchema,
  logoUploadRequestSchema,
  ownerProgramListQuerySchema,
  programIdParamsSchema,
  programListQuerySchema,
  programReviewerParamsSchema,
  programStatusChangeRequestSchema,
  transactionHashParamsSchema,
  updateProgramRequestSchema,
  type AssignReviewerRequest,
  type CreateProgramRequest,
  type DeployEscrowRequest,
  type EscrowTransactionListResponse,
  type EscrowTransactionResponse,
  type FundProgramRequest,
  type LogoUploadRequest,
  type OwnerProgramListQuery,
  type ProgramIdParams,
  type ProgramListQuery,
  type ProgramListResponse,
  type ProgramResponse,
  type ProgramReviewerListResponse,
  type ProgramReviewerParams,
  type ProgramStatusChangeRequest,
  type RequestPrincipal,
  type SignedLogoUploadResponse,
  type TransactionHashParams,
  type UpdateProgramRequest,
} from '@bug-bounty-escrow/shared';

import { ZodBody, ZodParam, ZodQuery } from '../openapi/zod-openapi.js';
import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ProgramService } from './program.service.js';

function requirePrincipal(principal: RequestPrincipal | undefined): RequestPrincipal {
  if (principal === undefined) {
    throw new UnauthorizedException();
  }

  return principal;
}

@Controller('programs')
export class ProgramController {
  public constructor(@Inject(ProgramService) private readonly service: ProgramService) {}

  /** Public bounty table. Never returns draft, awaiting-funding or paused programs. */
  @Public()
  @Get()
  public list(
    @ZodQuery(programListQuerySchema)
    query: ProgramListQuery,
  ): Promise<ProgramListResponse> {
    return this.service.listPublic(query);
  }

  @Roles('owner')
  @Post()
  public async create(
    @ZodBody(createProgramRequestSchema)
    input: CreateProgramRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramResponse> {
    return { success: true, data: await this.service.create(requirePrincipal(principal), input) };
  }

  @Public()
  @Get(':id')
  public async get(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramResponse> {
    return { success: true, data: await this.service.get(params.id, principal) };
  }

  @Roles('owner')
  @Patch(':id')
  public async update(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(updateProgramRequestSchema)
    input: UpdateProgramRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramResponse> {
    return {
      success: true,
      data: await this.service.update(requirePrincipal(principal), params.id, input),
    };
  }

  @Roles('owner')
  @Post(':id/logo/upload-url')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  public logoUploadUrl(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(logoUploadRequestSchema) input: LogoUploadRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<SignedLogoUploadResponse> {
    return this.service.createLogoUploadUrl(requirePrincipal(principal), params.id, input);
  }

  @Roles('owner')
  @Post(':id/deploy')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  public async deploy(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(deployEscrowRequestSchema) input: DeployEscrowRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramResponse> {
    return {
      success: true,
      data: await this.service.deployEscrow(requirePrincipal(principal), params.id, input),
    };
  }

  @Roles('owner')
  @Post(':id/fund')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  public async fund(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(fundProgramRequestSchema) input: FundProgramRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramResponse> {
    return {
      success: true,
      data: await this.service.fund(requirePrincipal(principal), params.id, input),
    };
  }

  @Roles('owner')
  @Post(':id/publish')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  public async publish(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramResponse> {
    return {
      success: true,
      data: await this.service.publish(requirePrincipal(principal), params.id),
    };
  }

  /** Pause, expire or close. Publishing has its own endpoint because it validates readiness. */
  @Roles('owner')
  @Post(':id/status')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  public async changeStatus(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(programStatusChangeRequestSchema)
    input: ProgramStatusChangeRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramResponse> {
    return {
      success: true,
      data: await this.service.changeStatus(requirePrincipal(principal), params.id, input),
    };
  }

  @Get(':id/reviewers')
  public async reviewers(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramReviewerListResponse> {
    return {
      success: true,
      data: await this.service.listReviewers(requirePrincipal(principal), params.id),
    };
  }

  @Roles('owner')
  @Post(':id/reviewers')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  public async addReviewer(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(assignReviewerRequestSchema) input: AssignReviewerRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramReviewerListResponse> {
    return {
      success: true,
      data: await this.service.assignReviewer(requirePrincipal(principal), params.id, input),
    };
  }

  @Roles('owner')
  @Delete(':id/reviewers/:reviewerId')
  public async removeReviewer(
    @ZodParam(programReviewerParamsSchema) params: ProgramReviewerParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramReviewerListResponse> {
    return {
      success: true,
      data: await this.service.removeReviewer(
        requirePrincipal(principal),
        params.id,
        params.reviewerId,
      ),
    };
  }

  @Get(':id/transactions')
  public transactions(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodQuery(commentListQuerySchema)
    query: { page: number; limit: number },
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<EscrowTransactionListResponse> {
    return this.service.listTransactions(
      requirePrincipal(principal),
      params.id,
      query.page,
      query.limit,
    );
  }
}

/** Owner workspace listing, kept off `/programs` so the public route can stay public-only. */
@Controller('owner/programs')
export class OwnerProgramController {
  public constructor(@Inject(ProgramService) private readonly service: ProgramService) {}

  @Roles('owner')
  @Get()
  public list(
    @ZodQuery(ownerProgramListQuerySchema)
    query: OwnerProgramListQuery,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ProgramListResponse> {
    return this.service.listOwned(requirePrincipal(principal), query);
  }
}

@Controller('transactions')
export class TransactionController {
  public constructor(@Inject(ProgramService) private readonly service: ProgramService) {}

  @Get(':hash')
  public async get(
    @ZodParam(transactionHashParamsSchema) params: TransactionHashParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<EscrowTransactionResponse> {
    return {
      success: true,
      data: await this.service.getTransaction(requirePrincipal(principal), params.hash),
    };
  }
}
