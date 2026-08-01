import { Controller, Get, Inject, NotFoundException, Post, UnauthorizedException } from '@nestjs/common';
import {
  createFundingIntentRequestSchema,
  createEscrowWalletChallengeRequestSchema,
  createSourceDepositRequestSchema,
  attachSourceDepositRequestSchema,
  createWithdrawalIntentRequestSchema,
  deployEscrowWithCircleRequestSchema,
  createDeploymentFeeQuoteRequestSchema,
  deploymentFeeQuoteResponseSchema,
  observeDeploymentFeePaymentRequestSchema,
  escrowDeploymentResponseSchema,
  escrowWalletChallengeResponseSchema,
  fundingIntentParamsSchema,
  fundingIntentResponseSchema,
  fundingOperationHistoryQuerySchema,
  fundingOperationHistoryResponseSchema,
  fundingDestinationAttemptRequestSchema,
  attachFundingDestinationRequestSchema,
  attachFundingRecoveryTelemetryRequestSchema,
  releaseRejectedSendAttemptRequestSchema,
  fundingRecoveryCheckRequestSchema,
  fundingConfirmationArtifactResponseSchema,
  gatewayFundingReadinessResponseSchema,
  observeFundingOperationRequestSchema,
  observeSourceDepositRequestSchema,
  walletBoundaryClaimRequestSchema,
  bridgeDeliveryRetryClaimRequestSchema,
  refreshFundingQuoteRequestSchema,
  sourceDepositParamsSchema,
  observeWithdrawalRequestSchema,
  programIdParamsSchema,
  withdrawalIntentParamsSchema,
  withdrawalIntentResponseSchema,
  type CreateFundingIntentRequest,
  type CreateEscrowWalletChallengeRequest,
  type CreateSourceDepositRequest,
  type AttachSourceDepositRequest,
  type CreateWithdrawalIntentRequest,
  type DeployEscrowWithCircleRequest,
  type CreateDeploymentFeeQuoteRequest,
  type ObserveDeploymentFeePaymentRequest,
  type DeploymentFeeQuote,
  type EscrowDeploymentResponse,
  type EscrowWalletChallengeResponse,
  type FundingIntentParams,
  type FundingIntentResponse,
  type FundingOperationHistoryQuery,
  type FundingOperationHistoryResponse,
  type FundingDestinationAttemptRequest,
  type AttachFundingDestinationRequest,
  type AttachFundingRecoveryTelemetryRequest,
  type ReleaseRejectedSendAttemptRequest,
  type FundingRecoveryCheckRequest,
  type FundingConfirmationArtifactResponse,
  type GatewayFundingReadinessResponse,
  type ObserveFundingOperationRequest,
  type ObserveSourceDepositRequest,
  type WalletBoundaryClaimRequest,
  type BridgeDeliveryRetryClaimRequest,
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
import { ApiZodResponse, ZodBody, ZodParam, ZodQuery } from '../openapi/zod-openapi.js';
import { EscrowService } from './escrow.service.js';

function requirePrincipal(principal: RequestPrincipal | undefined): RequestPrincipal {
  if (principal === undefined) throw new UnauthorizedException();
  return principal;
}

@Roles('owner')
@Controller('programs')
export class EscrowController {
  public constructor(@Inject(EscrowService) private readonly service: EscrowService) {}

  @Post(':id/escrow-wallet-challenges')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    201,
    'Short-lived EIP-191 challenge bound to the program owner and deployment wallets',
    escrowWalletChallengeResponseSchema,
  )
  public async createWalletChallenge(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(createEscrowWalletChallengeRequestSchema)
    input: CreateEscrowWalletChallengeRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<EscrowWalletChallengeResponse> {
    return {
      success: true,
      data: await this.service.createWalletChallenge(requirePrincipal(principal), params.id, input),
    };
  }

  @Post(':id/escrow-deployments')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @ApiZodResponse(
    201,
    'Circle deployment accepted and Arc-verified escrow state',
    escrowDeploymentResponseSchema,
  )
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

  @Post(':id/escrow-deployment-fees/quote')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @ApiZodResponse(201, 'Durable owner deployment-fee quote', deploymentFeeQuoteResponseSchema)
  public async deploymentFeeQuote(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(createDeploymentFeeQuoteRequestSchema) input: CreateDeploymentFeeQuoteRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<{ success: true; data: DeploymentFeeQuote }> {
    return { success: true, data: await this.service.createDeploymentFeeQuote(requirePrincipal(principal), params.id, input) };
  }

  @Post(':id/escrow-deployment-fees/payment')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(200, 'Verified owner deployment-fee payment', deploymentFeeQuoteResponseSchema)
  public async deploymentFeePayment(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @ZodBody(observeDeploymentFeePaymentRequestSchema) input: ObserveDeploymentFeePaymentRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<{ success: true; data: DeploymentFeeQuote }> {
    return { success: true, data: await this.service.observeDeploymentFeePayment(requirePrincipal(principal), params.id, input) };
  }

  @Get(':id/escrow-deployment-fees/current')
  @ApiZodResponse(200, 'Current deployment-fee quote and payment state', deploymentFeeQuoteResponseSchema)
  public async currentDeploymentFeeQuote(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<{ success: true; data: DeploymentFeeQuote }> {
    const quote = await this.service.getDeploymentFeeQuote(requirePrincipal(principal), params.id);
    if (quote === null) throw new NotFoundException();
    return { success: true, data: quote };
  }

  @Get(':id/escrow-deployments/current')
  @ApiZodResponse(
    200,
    'Current durable Circle deployment operation',
    escrowDeploymentResponseSchema,
  )
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
  @ApiZodResponse(
    201,
    'Server-derived immutable funding route and verified recipient',
    fundingIntentResponseSchema,
  )
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
  @ApiZodResponse(
    200,
    'Active durable funding intent for CP-12 recovery',
    fundingIntentResponseSchema,
  )
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
      data: await this.service.getLatestFundingConfirmation(requirePrincipal(principal), params.id),
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

  @Get(':id/funding-intents/:intentId/history')
  @ApiZodResponse(
    200,
    'Deterministically paginated complete source and destination recovery history',
    fundingOperationHistoryResponseSchema,
  )
  public async fundingOperationHistory(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodQuery(fundingOperationHistoryQuerySchema) query: FundingOperationHistoryQuery,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingOperationHistoryResponse> {
    return {
      success: true,
      data: await this.service.getFundingOperationHistory(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        query,
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
  @ApiZodResponse(
    200,
    'Atomically refreshed bounded Unified Balance quote',
    fundingIntentResponseSchema,
  )
  public async refreshFundingQuote(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(refreshFundingQuoteRequestSchema) input: RefreshFundingQuoteRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.refreshFundingQuote(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/prepare-destination')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Persist the Unified Balance second-Submit handoff to CP-12',
    fundingIntentResponseSchema,
  )
  public async prepareFundingDestination(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.prepareFundingDestination(
        requirePrincipal(principal),
        params.id,
        params.intentId,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/reopen-source-collection')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Safely return a pre-destination Unified Balance intent to exact source top-up collection',
    fundingIntentResponseSchema,
  )
  public async reopenFundingSourceCollection(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.reopenFundingSourceCollection(
        requirePrincipal(principal),
        params.id,
        params.intentId,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/destination-attempts')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    201,
    'Durable awaiting-signature destination attempt claimed before the wallet prompt',
    fundingIntentResponseSchema,
  )
  public async claimFundingDestinationAttempt(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(fundingDestinationAttemptRequestSchema)
    input: FundingDestinationAttemptRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.claimFundingDestinationAttempt(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input.idempotencyKey,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/destination-attempts/arm')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Atomically acquire the sole destination wallet-execution boundary',
    fundingIntentResponseSchema,
  )
  public async armFundingDestinationAttempt(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(walletBoundaryClaimRequestSchema) input: WalletBoundaryClaimRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.armFundingDestinationAttempt(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input.claimToken,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/destination-attempts/delivery-retry/arm')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Atomically acquire the sole Bridge delivery-retry boundary without replaying its burn',
    fundingIntentResponseSchema,
  )
  public async armBridgeDeliveryRetry(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(bridgeDeliveryRetryClaimRequestSchema) input: BridgeDeliveryRetryClaimRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.armBridgeDeliveryRetry(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input.operationRecordId,
        input.claimToken,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/destination-attempts/rejected')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Release only a Send signature rejected before any broadcast evidence exists',
    fundingIntentResponseSchema,
  )
  public async releaseRejectedSendAttempt(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(releaseRejectedSendAttemptRequestSchema)
    input: ReleaseRejectedSendAttemptRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.releaseRejectedSendAttempt(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input.operationRecordId,
        input.claimToken,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/destination-attempts/attach')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Attach the exact original destination hash to a claimed uncertain operation',
    fundingIntentResponseSchema,
  )
  public async attachFundingDestination(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(attachFundingDestinationRequestSchema)
    input: AttachFundingDestinationRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.attachFundingDestination(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input.operationRecordId,
        input.transactionHash,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/destination-attempts/recovery-telemetry')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Attach bounded recovery-only telemetry to an already-armed operation without wallet replay',
    fundingIntentResponseSchema,
  )
  public async attachFundingRecoveryTelemetry(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(attachFundingRecoveryTelemetryRequestSchema)
    input: AttachFundingRecoveryTelemetryRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.attachFundingRecoveryTelemetry(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/cancel')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Cancel a funding intent only while no transaction or uncertain submission exists',
    fundingIntentResponseSchema,
  )
  public async cancelFundingIntent(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.cancelFundingIntent(
        requirePrincipal(principal),
        params.id,
        params.intentId,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/destination-replacement')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    201,
    'Create a linked Send replacement only after a server-verified deterministic revert',
    fundingIntentResponseSchema,
  )
  public async createFundingDestinationReplacement(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.createFundingDestinationReplacement(
        requirePrincipal(principal),
        params.id,
        params.intentId,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/recovery/check')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Server-derived RPC receipt state for an already locked operation hash',
    fundingIntentResponseSchema,
  )
  public async checkFundingRecovery(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(fundingRecoveryCheckRequestSchema) input: FundingRecoveryCheckRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.checkFundingRecovery(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/source-deposits')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    201,
    'Durable immutable source deposit created before wallet prompt',
    fundingIntentResponseSchema,
  )
  public async createSourceDeposit(
    @ZodParam(fundingIntentParamsSchema) params: FundingIntentParams,
    @ZodBody(createSourceDepositRequestSchema) input: CreateSourceDepositRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.createSourceDeposit(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/source-deposits/:depositId/arm')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Atomically acquire the sole source-deposit wallet-execution boundary',
    fundingIntentResponseSchema,
  )
  public async armSourceDeposit(
    @ZodParam(sourceDepositParamsSchema) params: SourceDepositParams,
    @ZodBody(walletBoundaryClaimRequestSchema) input: WalletBoundaryClaimRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.armSourceDeposit(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        params.depositId,
        input.claimToken,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/source-deposits/:depositId/observations')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Bounded source deposit observation persisted without trusting settlement',
    fundingIntentResponseSchema,
  )
  public async observeSourceDeposit(
    @ZodParam(sourceDepositParamsSchema) params: SourceDepositParams,
    @ZodBody(observeSourceDepositRequestSchema) input: ObserveSourceDepositRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.observeSourceDeposit(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        params.depositId,
        input,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/source-deposits/:depositId/attach')
  @RateLimit({ limit: 10, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Known transaction attached and sent through the same independent verification path',
    fundingIntentResponseSchema,
  )
  public async attachSourceDeposit(
    @ZodParam(sourceDepositParamsSchema) params: SourceDepositParams,
    @ZodBody(attachSourceDepositRequestSchema) input: AttachSourceDepositRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.attachSourceDeposit(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        params.depositId,
        input,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/source-deposits/:depositId/reconcile')
  @RateLimit({ limit: 20, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Source RPC and signed Circle Gateway finalization independently reconciled',
    fundingIntentResponseSchema,
  )
  public async reconcileSourceDeposit(
    @ZodParam(sourceDepositParamsSchema) params: SourceDepositParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<FundingIntentResponse> {
    return {
      success: true,
      data: await this.service.reconcileSourceDeposit(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        params.depositId,
      ),
    };
  }

  @Post(':id/funding-intents/:intentId/operations')
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiZodResponse(
    200,
    'Persisted recovery telemetry; not yet trusted as settlement proof',
    fundingIntentResponseSchema,
  )
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
  @ApiZodResponse(
    200,
    'Arc receipt, USDC transfer, sync state, and pool reconciled',
    fundingIntentResponseSchema,
  )
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
  @ApiZodResponse(
    201,
    'Server-derived remaining-funds withdrawal intent',
    withdrawalIntentResponseSchema,
  )
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

  @Post(':id/withdrawal-intents/:intentId/replacement')
  @RateLimit({ limit: 5, windowMs: 60_000 })
  @ApiZodResponse(
    201,
    'Linked replacement for a server-verified failed withdrawal intent',
    withdrawalIntentResponseSchema,
  )
  public async createWithdrawalReplacement(
    @ZodParam(withdrawalIntentParamsSchema) params: WithdrawalIntentParams,
    @ZodBody(createWithdrawalIntentRequestSchema) input: CreateWithdrawalIntentRequest,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<WithdrawalIntentResponse> {
    return {
      success: true,
      data: await this.service.createWithdrawalReplacement(
        requirePrincipal(principal),
        params.id,
        params.intentId,
        input,
      ),
    };
  }

  @Get(':id/withdrawal-intents/active')
  @ApiZodResponse(
    200,
    'Active durable remaining-funds withdrawal intent',
    withdrawalIntentResponseSchema,
  )
  public async activeWithdrawalIntent(
    @ZodParam(programIdParamsSchema) params: ProgramIdParams,
    @CurrentPrincipal() principal?: RequestPrincipal,
  ): Promise<WithdrawalIntentResponse> {
    return {
      success: true,
      data: await this.service.getActiveWithdrawalIntent(requirePrincipal(principal), params.id),
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
  @ApiZodResponse(
    200,
    'Observed program-owner close or withdrawal transaction (admin support never withdraws program funds)',
    withdrawalIntentResponseSchema,
  )
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
  @ApiZodResponse(
    200,
    'Arc-verified program-owner close or idempotently reconciled withdrawal',
    withdrawalIntentResponseSchema,
  )
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
