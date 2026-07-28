import { Controller, Get, Inject, Put, UnauthorizedException } from '@nestjs/common';
import {
  payoutWalletResponseSchema,
  researcherRewardListQuerySchema,
  researcherRewardListResponseSchema,
  updatePayoutWalletRequestSchema,
  updatePayoutWalletResponseSchema,
  type PayoutWalletResponse,
  type RequestPrincipal,
  type ResearcherRewardListQuery,
  type ResearcherRewardListResponse,
  type UpdatePayoutWalletRequest,
  type UpdatePayoutWalletResponse,
} from '@bug-bounty-escrow/shared';

import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ApiZodResponse, ZodBody, ZodQuery } from '../openapi/zod-openapi.js';
import { RewardService } from './reward.service.js';

@Controller('rewards')
export class RewardController {
  public constructor(@Inject(RewardService) private readonly service: RewardService) {}

  @Roles('researcher')
  @Get('payout-wallet')
  @ApiZodResponse(
    200,
    'Payout destination and active-reward requirement for the authenticated researcher',
    payoutWalletResponseSchema,
  )
  public getPayoutWallet(
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<PayoutWalletResponse> {
    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    return this.service.getPayoutWallet(principal);
  }

  @Roles('researcher')
  @Put('payout-wallet')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Saved Arc USDC payout destination for the authenticated researcher',
    updatePayoutWalletResponseSchema,
  )
  public updatePayoutWallet(
    @ZodBody(updatePayoutWalletRequestSchema) input: UpdatePayoutWalletRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<UpdatePayoutWalletResponse> {
    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    return this.service.updatePayoutWallet(principal, input);
  }

  @Roles('researcher')
  @Get()
  @ApiZodResponse(
    200,
    'Paginated settlement activity for the authenticated researcher',
    researcherRewardListResponseSchema,
  )
  public list(
    @ZodQuery(researcherRewardListQuerySchema) query: ResearcherRewardListQuery,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ResearcherRewardListResponse> {
    if (principal === undefined) {
      throw new UnauthorizedException();
    }

    return this.service.list(principal, query);
  }
}
