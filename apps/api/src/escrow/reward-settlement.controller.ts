import { Controller, Get, Inject, Post, UnauthorizedException } from '@nestjs/common';
import {
  createRewardSettlementIntentRequestSchema,
  observeRewardApprovalRequestSchema,
  reportIdParamsSchema,
  rewardSettlementIntentResponseSchema,
  type CreateRewardSettlementIntentRequest,
  type ObserveRewardApprovalRequest,
  type RequestPrincipal,
  type RewardSettlementIntentResponse,
} from '@bug-bounty-escrow/shared';
import { z } from 'zod';

import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ApiZodResponse, ZodBody, ZodParam } from '../openapi/zod-openapi.js';
import { RewardSettlementService } from './reward-settlement.service.js';

const settlementParamsSchema = reportIdParamsSchema.extend({
  intentId: z.string().uuid(),
});

function requirePrincipal(principal: RequestPrincipal | undefined): RequestPrincipal {
  if (principal === undefined) throw new UnauthorizedException();
  return principal;
}

@Roles('owner')
@Controller('reports')
export class RewardSettlementController {
  public constructor(
    @Inject(RewardSettlementService) private readonly service: RewardSettlementService,
  ) {}

  @Post(':id/reward-settlement-intents')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    201,
    'Server-derived Arc reward settlement intent',
    rewardSettlementIntentResponseSchema,
  )
  public async create(
    @ZodParam(reportIdParamsSchema) params: { id: string },
    @ZodBody(createRewardSettlementIntentRequestSchema)
    input: CreateRewardSettlementIntentRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<RewardSettlementIntentResponse> {
    return {
      success: true,
      data: await this.service.create(requirePrincipal(principal), params.id, input),
    };
  }

  @Get(':id/reward-settlement-intents/current')
  @ApiZodResponse(
    200,
    'Current durable reward settlement intent',
    rewardSettlementIntentResponseSchema,
  )
  public async current(
    @ZodParam(reportIdParamsSchema) params: { id: string },
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<RewardSettlementIntentResponse> {
    return {
      success: true,
      data: await this.service.current(requirePrincipal(principal), params.id),
    };
  }

  @Post(':id/reward-settlement-intents/:intentId/approval-observations')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Persisted owner approval submission and reconciliation',
    rewardSettlementIntentResponseSchema,
  )
  public async observeApproval(
    @ZodParam(settlementParamsSchema) params: { id: string; intentId: string },
    @ZodBody(observeRewardApprovalRequestSchema) input: ObserveRewardApprovalRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<RewardSettlementIntentResponse> {
    return {
      success: true,
      data: await this.service.observeApproval(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input,
      ),
    };
  }

  @Post(':id/reward-settlement-intents/:intentId/reconcile')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Arc evidence and Circle payout relay reconciliation',
    rewardSettlementIntentResponseSchema,
  )
  public async reconcile(
    @ZodParam(settlementParamsSchema) params: { id: string; intentId: string },
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<RewardSettlementIntentResponse> {
    return {
      success: true,
      data: await this.service.reconcile(requirePrincipal(principal), params.id, params.intentId),
    };
  }

  @Post(':id/reward-settlement-intents/:intentId/cancel')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Cancelled pre-submission reward intent and released reservation',
    rewardSettlementIntentResponseSchema,
  )
  public async cancel(
    @ZodParam(settlementParamsSchema) params: { id: string; intentId: string },
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<RewardSettlementIntentResponse> {
    return {
      success: true,
      data: await this.service.cancel(requirePrincipal(principal), params.id, params.intentId),
    };
  }
}
