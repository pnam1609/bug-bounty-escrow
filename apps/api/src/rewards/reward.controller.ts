import {
  Controller,
  Get,
  GoneException,
  Inject,
  Post,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import {
  createPayoutWalletChallengeRequestSchema,
  payoutWalletChallengeResponseSchema,
  payoutWalletResponseSchema,
  researcherPayoutWalletListResponseSchema,
  researcherPayoutWalletResponseSchema,
  researcherRewardListQuerySchema,
  researcherRewardListResponseSchema,
  updatePayoutWalletRequestSchema,
  updatePayoutWalletResponseSchema,
  verifyPayoutWalletRequestSchema,
  type CreatePayoutWalletChallengeRequest,
  type PayoutWalletChallengeResponse,
  type PayoutWalletResponse,
  type RequestPrincipal,
  type ResearcherRewardListQuery,
  type ResearcherRewardListResponse,
  type ResearcherPayoutWalletListResponse,
  type ResearcherPayoutWalletResponse,
  type UpdatePayoutWalletRequest,
  type UpdatePayoutWalletResponse,
  type VerifyPayoutWalletRequest,
} from '@bug-bounty-escrow/shared';
import { z } from 'zod';

import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { createApiErrorResponse } from '../common/http/api-error.js';
import { ApiZodResponse, ZodBody, ZodParam, ZodQuery } from '../openapi/zod-openapi.js';
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
    void input;
    void principal;
    throw new GoneException(
      createApiErrorResponse(
        'payout_wallet_verification_required',
        'Payout wallets must be connected and verified with a signed challenge.',
      ),
    );
  }

  @Roles('researcher')
  @Get('payout-wallets')
  @ApiZodResponse(
    200,
    'Verified Arc payout wallets owned by the authenticated researcher',
    researcherPayoutWalletListResponseSchema,
  )
  public async listPayoutWallets(
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ResearcherPayoutWalletListResponse> {
    if (principal === undefined) throw new UnauthorizedException();
    return { success: true, data: await this.service.listPayoutWallets(principal) };
  }

  @Roles('researcher')
  @Post('payout-wallet-challenges')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @ApiZodResponse(
    201,
    'Short-lived single-use Arc payout-wallet verification challenge',
    payoutWalletChallengeResponseSchema,
  )
  public async createPayoutWalletChallenge(
    @ZodBody(createPayoutWalletChallengeRequestSchema)
    input: CreatePayoutWalletChallengeRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<PayoutWalletChallengeResponse> {
    if (principal === undefined) throw new UnauthorizedException();
    return {
      success: true,
      data: await this.service.createPayoutWalletChallenge(principal, input),
    };
  }

  @Roles('researcher')
  @Post('payout-wallet-challenges/:id/verify')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Verified and durably saved Arc payout wallet',
    researcherPayoutWalletResponseSchema,
  )
  public async verifyPayoutWallet(
    @ZodParam(z.object({ id: z.string().uuid() }).strict()) params: { id: string },
    @ZodBody(verifyPayoutWalletRequestSchema) input: VerifyPayoutWalletRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<ResearcherPayoutWalletResponse> {
    if (principal === undefined) throw new UnauthorizedException();
    return {
      success: true,
      data: await this.service.verifyPayoutWallet(principal, params.id, input),
    };
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
