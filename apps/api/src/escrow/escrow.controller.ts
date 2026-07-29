import { Controller, Get, Inject, Post, UnauthorizedException } from '@nestjs/common';
import {
  createFundingIntentRequestSchema,
  createSourceDepositRequestSchema,
  attachSourceDepositRequestSchema,
  createWithdrawalIntentRequestSchema,
  deployEscrowWithCircleRequestSchema,
  escrowDeploymentResponseSchema,
  fundingIntentParamsSchema,
  fundingIntentResponseSchema,
  fundingConfirmationArtifactResponseSchema,
  gatewayFundingReadinessResponseSchema,
  observeFundingOperationRequestSchema,
  observeSourceDepositRequestSchema,
  refreshFundingQuoteRequestSchema,
  sourceDepositParamsSchema,
  observeWithdrawalRequestSchema,
  programIdParamsSchema,
  withdrawalIntentParamsSchema,
  withdrawalIntentResponseSchema,
  type CreateFundingIntentRequest,
  type CreateSourceDepositRequest,
  type AttachSourceDepositRequest,
  type CreateWithdrawalIntentRequest,
  type DeployEscrowWithCircleRequest,
  type EscrowDeploymentResponse,
  type FundingIntentParams,
  type FundingIntentResponse,
  type FundingConfirmationArtifactResponse,
  type GatewayFundingReadinessResponse,
  type ObserveFundingOperationRequest,
  type ObserveSourceDepositRequest,
  type RefreshFundingQuoteRequest,
  type SourceDepositParams,
  type ObserveWithdrawalRequest,
  type ProgramIdParams,
  type RequestPrincipal,
  type WithdrawalIntentParams,
  type WithdrawalIntentResponse,
} from '@bug-bounty-escrow/shared';

import { CurrentPrincipal } from '../common/decorators/current-principal.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ApiZodResponse, ZodBody, ZodParam } from '../openapi/zod-openapi.js';
import { EscrowService } from './escrow.service.js';

function requirePrincipal(principal: RequestPrincipal | undefined): RequestPrincipal {
  if (principal === undefined) throw new UnauthorizedException();
  return principal;
}

@Roles('owner')
@Controller('programs')
export class EscrowController {
  public constructor(@Inject(EscrowService) private readonly service: EscrowService) {}

  @Post(':id/escrow-deployments')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @ApiZodResponse(201, 'Circle deployment accepted and Arc-verified escrow state', escrowDeploymentResponseSchema)
  public async deploy(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(deployEscrowWithCircleRequestSchema) input: DeployEscrowWithCircleRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<EscrowDeploymentResponse> {
    return {
      success: true,
      data: await this.service.deploy(requirePrincipal(principal), params.id, input),
    };
  }

  @Get(':id/escrow-deployments/current')
  @ApiZodResponse(200, 'Current durable Circle deployment operation', escrowDeploymentResponseSchema)
  public async deployment(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<EscrowDeploymentResponse> {
    return {
      success: true,
      data: await this.service.getDeployment(requirePrincipal(principal), params.id),
    };
  }

  @Post(':id/funding-intents')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(201, 'Server-derived immutable funding route and verified recipient', fundingIntentResponseSchema)
  public async createFundingIntent(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(createFundingIntentRequestSchema) input: CreateFundingIntentRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.createFundingIntent(requirePrincipal(principal), params.id, input),
    };
  }

  @Get(':id/funding-intents/active')
  @ApiZodResponse(200, 'Active durable funding intent for CP-12 recovery', fundingIntentResponseSchema)
  public async activeFundingIntent(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.getActiveFundingIntent(requirePrincipal(principal), params.id),
    };
  }

  @Get(':id/funding-confirmations/latest')
  @ApiZodResponse(
    200,
    'Latest immutable canonical funding confirmation artifact for CP-13 reload',
    fundingConfirmationArtifactResponseSchema,
  )
  public async latestFundingConfirmation(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingConfirmationArtifactResponse> {
    return {
      success: true,
      data: await this.service.getLatestFundingConfirmation(
        requirePrincipal(principal),
        params.id,
      ),
    };
  }

  @Get(':id/funding-intents/:intentId')
  @ApiZodResponse(200, 'Durable funding intent state', fundingIntentResponseSchema)
  public async fundingIntent(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.getFundingIntent(
        requirePrincipal(principal),
        params.id,
        params.intentId,
      ),
    };
  }

  @Get(':id/funding-intents/:intentId/gateway-readiness')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Server-read confirmed Gateway balances for the exact selected source domains',
    gatewayFundingReadinessResponseSchema,
  )
  public async gatewayReadiness(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<GatewayFundingReadinessResponse> {
    return {
      success: true,
      data: await this.service.getGatewayFundingReadiness(
        requirePrincipal(principal),
        params.id,
        params.intentId,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/quote')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(200, 'Atomically refreshed bounded Unified Balance quote', fundingIntentResponseSchema)
  public async refreshFundingQuote(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(refreshFundingQuoteRequestSchema) input: RefreshFundingQuoteRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return { success: true, data: await this.service.refreshFundingQuote(requirePrincipal(principal), params.id, params.intentId, input) };
  }

  @Post(':id/funding-intents/:intentId/source-deposits')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(201, 'Durable immutable source deposit created before wallet prompt', fundingIntentResponseSchema)
  public async createSourceDeposit(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(createSourceDepositRequestSchema) input: CreateSourceDepositRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return { success: true, data: await this.service.createSourceDeposit(requirePrincipal(principal), params.id, params.intentId, input) };
  }

  @Post(':id/funding-intents/:intentId/source-deposits/:depositId/observations')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiZodResponse(200, 'Bounded source deposit observation persisted without trusting settlement', fundingIntentResponseSchema)
  public async observeSourceDeposit(
    @ZodParam(sourceDepositParamsSchema) params: SourceDepositParams,
    @ZodBody(observeSourceDepositRequestSchema) input: ObserveSourceDepositRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return { success: true, data: await this.service.observeSourceDeposit(requirePrincipal(principal), params.id, params.intentId, params.depositId, input) };
  }

  @Post(':id/funding-intents/:intentId/source-deposits/:depositId/attach')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(200, 'Known transaction attached and sent through the same independent verification path', fundingIntentResponseSchema)
  public async attachSourceDeposit(
    @ZodParam(sourceDepositParamsSchema) params: SourceDepositParams,
    @ZodBody(attachSourceDepositRequestSchema) input: AttachSourceDepositRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return { success: true, data: await this.service.attachSourceDeposit(requirePrincipal(principal), params.id, params.intentId, params.depositId, input) };
  }

  @Post(':id/funding-intents/:intentId/source-deposits/:depositId/reconcile')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(200, 'Source RPC and signed Circle Gateway finalization independently reconciled', fundingIntentResponseSchema)
  public async reconcileSourceDeposit(
    @ZodParam(sourceDepositParamsSchema) params: SourceDepositParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return { success: true, data: await this.service.reconcileSourceDeposit(requirePrincipal(principal), params.id, params.intentId, params.depositId) };
  }

  @Post(':id/funding-intents/:intentId/operations')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiZodResponse(200, 'Persisted recovery telemetry; not yet trusted as settlement proof', fundingIntentResponseSchema)
  public async observeFunding(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(observeFundingOperationRequestSchema) input: ObserveFundingOperationRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.observeFunding(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/reconcile')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(200, 'Arc receipt, USDC transfer, sync state, and pool reconciled', fundingIntentResponseSchema)
  public async reconcileFunding(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.reconcileFunding(
        requirePrincipal(principal),
        params.id,
        params.intentId,
      ),
    };
  }

  @Post(':id/withdrawal-intents')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @ApiZodResponse(201, 'Server-derived remaining-funds withdrawal intent', withdrawalIntentResponseSchema)
  public async createWithdrawalIntent(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(createWithdrawalIntentRequestSchema) input: CreateWithdrawalIntentRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<WithdrawalIntentResponse> {
    return {
      success: true,
      data: await this.service.createWithdrawalIntent(
        requirePrincipal(principal),
        params.id,
        input,
      ),
    };
  }

  @Get(':id/withdrawal-intents/active')
  @ApiZodResponse(200, 'Active durable remaining-funds withdrawal intent', withdrawalIntentResponseSchema)
  public async activeWithdrawalIntent(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<WithdrawalIntentResponse> {
    return {
      success: true,
      data: await this.service.getActiveWithdrawalIntent(
        requirePrincipal(principal),
        params.id,
      ),
    };
  }

  @Get(':id/withdrawal-intents/:intentId')
  @ApiZodResponse(200, 'Durable remaining-funds withdrawal state', withdrawalIntentResponseSchema)
  public async withdrawalIntent(
    @ZodParam(withdrawalIntentParamsSchema) params: WithdrawalIntentParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<WithdrawalIntentResponse> {
    return {
      success: true,
      data: await this.service.getWithdrawalIntent(
        requirePrincipal(principal),
        params.id,
        params.intentId,
      ),
    };
  }

  @Post(':id/withdrawal-intents/:intentId/operations')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(200, 'Observed owner-signed close or withdrawal transaction', withdrawalIntentResponseSchema)
  public async observeWithdrawal(
    @ZodParam(withdrawalIntentParamsSchema) params: WithdrawalIntentParams,
    @ZodBody(observeWithdrawalRequestSchema) input: ObserveWithdrawalRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<WithdrawalIntentResponse> {
    return {
      success: true,
      data: await this.service.observeWithdrawal(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input,
      ),
    };
  }

  @Post(':id/withdrawal-intents/:intentId/reconcile')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(200, 'Arc-verified close or idempotently reconciled withdrawal', withdrawalIntentResponseSchema)
  public async reconcileWithdrawal(
    @ZodParam(withdrawalIntentParamsSchema) params: WithdrawalIntentParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<WithdrawalIntentResponse> {
    return {
      success: true,
      data: await this.service.reconcileWithdrawal(
        requirePrincipal(principal),
        params.id,
        params.intentId,
      ),
    };
  }
}
