import { randomUUID } from 'node:crypto';

import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ARC_TESTNET_USDC_ADDRESS,
  FUNDING_NETWORK_CONFIG,
  GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
  formatUsdcBaseUnits,
  type AttachSourceDepositRequest,
  type CircleGatewayDepositFinalizedWebhook,
  type CreateSourceDepositRequest,
  type CreateWithdrawalIntentRequest,
  parseUsdcBaseUnits,
  type ApiEnvironment,
  type CreateFundingIntentRequest,
  type DeployEscrowWithCircleRequest,
  type EscrowDeployment,
  type FundingIntent,
  type FundingConfirmationArtifact,
  type GatewayFundingReadiness,
  type ObserveFundingOperationRequest,
  type ObserveSourceDepositRequest,
  type RefreshFundingQuoteRequest,
  type ObserveWithdrawalRequest,
  type RequestPrincipal,
  type WithdrawalIntent,
} from '@bug-bounty-escrow/shared';
import { encodeAbiParameters, keccak256, stringToHex, type Hex } from 'viem';

import { API_CONFIG } from '../config/api-config.module.js';
import { loadEscrowArtifact } from './escrow-artifact.js';
import {
  ARC_ESCROW_GATEWAY,
  CIRCLE_CONTRACTS_GATEWAY,
  EscrowProviderError,
  type ArcEscrowGateway,
  type CircleContractsGateway,
  type EscrowArtifact,
} from './escrow-gateways.js';
import {
  EscrowRepository,
  type EscrowDeploymentRow,
  type FundingIntentRow,
  type WithdrawalIntentRow,
} from './escrow.repository.js';
import { GatewaySubscriptionLifecycleService } from './gateway-subscription-lifecycle.service.js';

const INTENT_TTL_MS = 30 * 60 * 1000;
const LATE_FUNDING_BATCH_SIZE = 500;
const PROGRAM_KEY_DOMAIN = keccak256(stringToHex('bountyescrow.xyz/BountyEscrow/v1'));

function canonicalProgramKey(programId: string): Hex {
  const uuidBytes = `0x${programId.replaceAll('-', '')}` as Hex;
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes16' }],
      [PROGRAM_KEY_DOMAIN, 5_042_002n, uuidBytes],
    ),
  );
}

function asAddress(value: string): `0x${string}` {
  return value as `0x${string}`;
}

@Injectable()
export class EscrowService {
  public constructor(
    @Inject(EscrowRepository) private readonly repository: EscrowRepository,
    @Inject(CIRCLE_CONTRACTS_GATEWAY) private readonly circle: CircleContractsGateway,
    @Inject(ARC_ESCROW_GATEWAY) private readonly arc: ArcEscrowGateway,
    @Inject(API_CONFIG) private readonly config: ApiEnvironment,
    @Inject(GatewaySubscriptionLifecycleService)
    private readonly gatewaySubscriptions: GatewaySubscriptionLifecycleService,
  ) {}

  public async deploy(
    principal: RequestPrincipal,
    programId: string,
    input: DeployEscrowWithCircleRequest,
  ): Promise<EscrowDeployment> {
    await this.requireOwner(principal, programId);
    const programDeadline = await this.repository.getProgramDeadline(programId);
    if (programDeadline === null) {
      throw new ConflictException('program_deadline_required_for_escrow');
    }
    if (Date.parse(input.refundUnlockAt) !== Date.parse(programDeadline)) {
      throw new ConflictException('refund_unlock_must_equal_program_deadline');
    }
    const artifact = await loadEscrowArtifact(this.config.BOUNTY_ESCROW_ARTIFACT_PATH);
    const programKey = canonicalProgramKey(programId);
    let deployment = await this.repository.findDeployment(programId);
    if (deployment !== null) {
      this.assertDeploymentParameters(deployment, input, programKey, artifact);
      if (deployment.deployment_status === 'confirmed' || deployment.deployment_status === 'failed') {
        return this.repository.toEscrowDeployment(deployment);
      }
    } else {
      if (new Date(input.refundUnlockAt).getTime() <= Date.now()) {
        throw new ConflictException('refund_unlock_must_be_in_the_future');
      }
      deployment = await this.repository.createDeploymentRecord({
        actorId: principal.userId,
        programId,
        programKey,
        ownerWallet: input.ownerWallet,
        withdrawRecipient: input.withdrawRecipient,
        refundUnlockAt: input.refundUnlockAt,
        artifactChecksum: artifact.artifactSha256,
        runtimeChecksum: artifact.runtimeBytecodeSha256,
        immutableReferences: artifact.immutableReferences,
        idempotencyKey: randomUUID(),
      });
    }

    try {
      if (deployment.circle_contract_id === null || deployment.circle_transaction_id === null) {
        const accepted = await this.circle.deploy({
          idempotencyKey: deployment.deploy_idempotency_key,
          programId,
          programKey,
          ownerWallet: asAddress(input.ownerWallet),
          tokenAddress: asAddress(ARC_TESTNET_USDC_ADDRESS),
          refundUnlockAt: BigInt(Math.floor(new Date(input.refundUnlockAt).getTime() / 1000)),
          withdrawRecipient: asAddress(input.withdrawRecipient),
          artifact,
        });
        deployment = await this.repository.storeCircleDeploymentIdentifiers(
          deployment.id,
          accepted.contractId,
          accepted.transactionId,
        );
      }
      const result = await this.circle.waitForDeployment({
        contractId: deployment.circle_contract_id!,
        transactionId: deployment.circle_transaction_id!,
      });
      if (result.state === 'failed') {
        return this.repository.toEscrowDeployment(
          await this.repository.failDeployment(deployment.id, result.failureCode),
        );
      }
      if (result.state === 'pending') {
        return this.repository.toEscrowDeployment(deployment);
      }
      const refundUnlockAt = BigInt(
        Math.floor(new Date(input.refundUnlockAt).getTime() / 1000),
      );
      await this.arc.verifyDeployment({
        artifact,
        contractAddress: result.contractAddress,
        transactionHash: result.transactionHash,
        expectedBlockNumber: result.blockNumber,
        expectedBlockHash: result.blockHash,
        programKey,
        ownerWallet: asAddress(input.ownerWallet),
        refundUnlockAt,
        withdrawRecipient: asAddress(input.withdrawRecipient),
      });
      return this.repository.toEscrowDeployment(
        await this.repository.confirmDeployment(deployment.id, {
          contractAddress: result.contractAddress,
          transactionHash: result.transactionHash,
          blockNumber: result.blockNumber,
          blockHash: result.blockHash,
          deploymentWalletReference: result.deploymentWalletAddress,
        }),
      );
    } catch (error) {
      this.rethrowProviderError(error);
    }
  }

  public async getDeployment(
    principal: RequestPrincipal,
    programId: string,
  ): Promise<EscrowDeployment> {
    await this.requireOwner(principal, programId);
    const deployment = await this.repository.findDeployment(programId);
    if (
      deployment === null ||
      deployment.circle_contract_id === null ||
      deployment.circle_transaction_id === null
    ) {
      throw new NotFoundException();
    }
    return this.repository.toEscrowDeployment(deployment);
  }

  public async createFundingIntent(
    principal: RequestPrincipal,
    programId: string,
    input: CreateFundingIntentRequest,
  ): Promise<FundingIntent> {
    await this.requireOwner(principal, programId);
    const escrow = await this.repository.findConfirmedEscrow(programId);
    if (
      escrow === null ||
      escrow.token_address === null ||
      escrow.token_address.toLowerCase() !== ARC_TESTNET_USDC_ADDRESS.toLowerCase()
    ) {
      throw new ConflictException('verified_arc_escrow_required');
    }
    const grossBaseUnits = parseUsdcBaseUnits(input.grossAmount);
    const feeReserveBaseUnits = parseUsdcBaseUnits(input.estimatedFeeReserve);
    if (grossBaseUnits === undefined || feeReserveBaseUnits === undefined) {
      throw new ConflictException('funding_amount_invalid');
    }
    try {
      const [preBalanceBaseUnits, preTotalFundedBaseUnits] = await Promise.all([
        this.arc.getCanonicalUsdcBalance(escrow.contract_address),
        this.arc.getEscrowTotalFunded(escrow.contract_address),
      ]);
      const row = await this.repository.createFundingIntent({
        actorId: principal.userId,
        programId,
        idempotencyKey: input.idempotencyKey,
        walletAddress: input.walletAddress,
        grossBaseUnits,
        feeReserveBaseUnits,
        feeAllocations: input.feeAllocations.map((allocation) => ({
          network: allocation.network,
          amountBaseUnits: parseUsdcBaseUnits(allocation.amount)!.toString(),
        })),
        sources: input.sources.map((source) => ({
          network: source.network,
          amountBaseUnits: parseUsdcBaseUnits(source.amount)!.toString(),
        })),
        preBalanceBaseUnits,
        preTotalFundedBaseUnits,
        expiresAt: new Date(Date.now() + INTENT_TTL_MS).toISOString(),
        quoteQuotedAt: input.quoteQuotedAt,
        quoteExpiresAt: input.quoteExpiresAt,
      });
      return this.repository.toFundingIntent(row);
    } catch (error) {
      this.rethrowProviderError(error);
    }
  }

  public async getActiveFundingIntent(
    principal: RequestPrincipal,
    programId: string,
  ): Promise<FundingIntent> {
    await this.requireOwner(principal, programId);
    const row = await this.repository.findActiveFundingIntent(programId);
    if (row === null) throw new NotFoundException();
    return this.repository.toFundingIntent(row);
  }

  public async getFundingIntent(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
  ): Promise<FundingIntent> {
    await this.requireOwner(principal, programId);
    return this.repository.toFundingIntent(
      await this.requireFundingIntent(programId, intentId),
    );
  }

  public async getLatestFundingConfirmation(
    principal: RequestPrincipal,
    programId: string,
  ): Promise<FundingConfirmationArtifact> {
    await this.requireOwner(principal, programId);
    const artifact = await this.repository.findLatestFundingConfirmation(programId);
    if (artifact === null) throw new NotFoundException();
    return this.repository.toFundingConfirmationArtifact(artifact);
  }

  public async getGatewayFundingReadiness(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
  ): Promise<GatewayFundingReadiness> {
    await this.requireOwner(principal, programId);
    const intent = await this.requireFundingIntent(programId, intentId);
    if (intent.route_mode !== 'unified_balance') {
      throw new ConflictException('gateway_readiness_requires_unified_balance');
    }
    return this.evaluateGatewayFundingReadiness(intent);
  }

  public async refreshFundingQuote(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
    input: RefreshFundingQuoteRequest,
  ): Promise<FundingIntent> {
    await this.requireOwner(principal, programId);
    await this.requireFundingIntent(programId, intentId);
    const fee = parseUsdcBaseUnits(input.estimatedFeeReserve);
    if (fee === undefined) throw new ConflictException('funding_quote_invalid');
    await this.repository.refreshFundingQuote({
      actorId: principal.userId,
      programId,
      intentId,
      feeReserveBaseUnits: fee,
      feeAllocations: input.feeAllocations.map((allocation) => ({
        network: allocation.network,
        amountBaseUnits: parseUsdcBaseUnits(allocation.amount)!.toString(),
      })),
      quotedAt: input.quotedAt,
      expiresAt: input.expiresAt,
    });
    return this.repository.toFundingIntent(await this.requireFundingIntent(programId, intentId));
  }

  public async createSourceDeposit(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
    input: CreateSourceDepositRequest,
  ): Promise<FundingIntent> {
    await this.requireOwner(principal, programId);
    const intent = await this.requireFundingIntent(programId, intentId);
    if (intent.route_mode !== 'unified_balance') {
      throw new ConflictException('source_deposit_requires_unified_balance');
    }
    const source = intent.sources.find(({ network }) => network === input.network);
    if (source === undefined) throw new ConflictException('source_deposit_network_not_allocated');
    const network = FUNDING_NETWORK_CONFIG[input.network];
    try {
      // The client must not be instructed to transfer funds until Circle's
      // remotely verified filter includes this intent's wallet and domains.
      await this.gatewaySubscriptions.ensureIntentRegistered(intent.id);
      const preGatewayBalance = await this.arc.getGatewayConfirmedBalance(
        input.network,
        intent.wallet_address,
      );
      const allocationBaseUnits = BigInt(source.amountBaseUnits);
      const sourceFeeBaseUnits = BigInt(
        intent.fee_allocations.find(({ network: feeNetwork }) => feeNetwork === input.network)
          ?.amountBaseUnits ?? '0',
      );
      const requiredConfirmedBaseUnits =
        allocationBaseUnits + sourceFeeBaseUnits;
      const depositAmountBaseUnits =
        requiredConfirmedBaseUnits > preGatewayBalance
          ? requiredConfirmedBaseUnits - preGatewayBalance
          : 0n;
      if (depositAmountBaseUnits === 0n) {
        throw new ConflictException('source_deposit_not_required');
      }
      await this.repository.createSourceDeposit({
        actorId: principal.userId,
        programId,
        intentId,
        network: input.network,
        chainId: network.chainId,
        tokenAddress: network.tokenAddress,
        gatewayWalletAddress: GATEWAY_WALLET_EVM_TESTNET_ADDRESS,
        walletAddress: intent.wallet_address,
        amountBaseUnits: depositAmountBaseUnits,
        preGatewayBalanceBaseUnits: preGatewayBalance,
      });
      return this.repository.toFundingIntent(await this.requireFundingIntent(programId, intentId));
    } catch (error) {
      this.rethrowProviderError(error);
    }
  }

  public async observeSourceDeposit(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
    depositId: string,
    input: ObserveSourceDepositRequest,
  ): Promise<FundingIntent> {
    await this.requireOwner(principal, programId);
    await this.requireFundingIntent(programId, intentId);
    await this.repository.observeSourceDeposit({
      actorId: principal.userId,
      programId,
      intentId,
      depositId,
      observation: input,
    });
    return this.repository.toFundingIntent(await this.requireFundingIntent(programId, intentId));
  }

  public async attachSourceDeposit(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
    depositId: string,
    input: AttachSourceDepositRequest,
  ): Promise<FundingIntent> {
    await this.observeSourceDeposit(principal, programId, intentId, depositId, {
      outcome: 'submitted',
      transactionHash: input.transactionHash,
    });
    return this.reconcileSourceDeposit(principal, programId, intentId, depositId);
  }

  public async reconcileSourceDeposit(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
    depositId: string,
  ): Promise<FundingIntent> {
    await this.requireOwner(principal, programId);
    await this.requireFundingIntent(programId, intentId);
    const deposit = await this.repository.findSourceDeposit(depositId);
    if (deposit === null || deposit.funding_intent_id !== intentId) throw new NotFoundException();
    if (deposit.status === 'confirmed') {
      return this.repository.toFundingIntent(await this.requireFundingIntent(programId, intentId));
    }
    if (deposit.transaction_hash == null || deposit.source_chain == null ||
        deposit.source_address == null || deposit.requested_amount_base_units == null) {
      throw new ConflictException('source_deposit_transaction_not_attached');
    }
    try {
      const verified = await this.arc.verifySourceDeposit({
        network: deposit.source_chain,
        walletAddress: deposit.source_address,
        amountBaseUnits: BigInt(deposit.requested_amount_base_units),
        transactionHash: deposit.transaction_hash,
      });
      await this.repository.recordSourceDepositOnchain({
        depositId,
        transactionHash: verified.transactionHash,
        gatewayLogIndex: verified.gatewayLogIndex,
        transferLogIndex: verified.transferLogIndex,
        blockNumber: verified.blockNumber,
        blockHash: verified.blockHash,
      });
      await this.repository.confirmSourceDeposit({
        depositId,
        transactionHash: verified.transactionHash,
        logIndex: verified.gatewayLogIndex,
        blockNumber: verified.blockNumber,
        blockHash: verified.blockHash,
      });
      return this.repository.toFundingIntent(await this.requireFundingIntent(programId, intentId));
    } catch (error) {
      if (error instanceof EscrowProviderError && error.code === 'source_deposit_reverted') {
        await this.repository.failSourceDepositReverted(depositId, deposit.transaction_hash);
      }
      this.rethrowProviderError(error);
    }
  }

  public async ingestGatewayDepositFinalized(
    event: CircleGatewayDepositFinalizedWebhook,
  ): Promise<void> {
    if (!this.config.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS.includes(event.subscriptionId)) {
      throw new ForbiddenException('circle_webhook_subscription_not_allowed');
    }
    const amount = parseUsdcBaseUnits(event.notification.amount);
    if (amount === undefined) throw new ConflictException('gateway_deposit_amount_invalid');
    await this.repository.ingestGatewayDepositFinalized({
      notificationId: event.notificationId,
      eventId: event.notification.id,
      subscriptionId: event.subscriptionId,
      domain: Number(event.notification.domain),
      walletAddress: event.notification.walletAddress,
      tokenAddress: event.notification.tokenAddress,
      amountBaseUnits: amount,
      fromAddress: event.notification.from,
      toAddress: event.notification.to,
      transactionHash: event.notification.txHash,
      timestamp: event.timestamp,
      version: event.version,
    });
  }

  public async observeFunding(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
    input: ObserveFundingOperationRequest,
  ): Promise<FundingIntent> {
    await this.requireOwner(principal, programId);
    const current = await this.requireFundingIntent(programId, intentId);
    const hasDestinationBoundary = (current.funding_operations ?? []).some(
      ({ operation_type }) =>
        operation_type === 'send' ||
        operation_type === 'bridge' ||
        operation_type === 'spend',
    );
    if (current.route_mode === 'unified_balance' && !hasDestinationBoundary) {
      if (input.submissionUncertain !== true) {
        throw new ConflictException('gateway_readiness_boundary_required');
      }
      const readiness = await this.evaluateGatewayFundingReadiness(current);
      if (!readiness.ready) {
        throw new ConflictException('gateway_confirmed_balance_insufficient');
      }
    }
    if (
      Date.parse(current.expires_at) <= Date.now() &&
      current.destination_transaction_hash === null &&
      (current.funding_operations?.length ?? 0) === 0 &&
      input.destinationTransactionHash === undefined
    ) {
      throw new ConflictException('funding_intent_expired');
    }
    await this.repository.observeFundingOperation(intentId, input);
    return this.repository.toFundingIntent(
      await this.requireFundingIntent(programId, intentId),
    );
  }

  public async reconcileFunding(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
  ): Promise<FundingIntent> {
    await this.requireOwner(principal, programId);
    let row = await this.requireFundingIntent(programId, intentId);
    if (row.status === 'complete') return this.repository.toFundingIntent(row);
    if (row.destination_transaction_hash === null) {
      throw new ConflictException('funding_destination_not_submitted');
    }
    const leaseId = randomUUID();
    const leaseDuration = Math.min(
      14 * 60 * 1000,
      this.config.CIRCLE_POLL_TIMEOUT_MS +
        this.config.CIRCLE_REQUEST_TIMEOUT_MS * 2 +
        60_000,
    );
    const claimed = await this.repository.claimFundingReconciliation(
      intentId,
      leaseId,
      new Date(Date.now() + leaseDuration).toISOString(),
    );
    if (!claimed) {
      throw new ConflictException('funding_reconciliation_already_claimed');
    }
    const escrow = await this.repository.findConfirmedEscrow(programId);
    if (escrow === null || escrow.id !== row.escrow_contract_id) {
      throw new ConflictException('verified_arc_escrow_required');
    }
    let circleTransactionId = row.sync_circle_transaction_id;
    try {
      const destination = await this.arc.verifyFundingDestination({
        escrowAddress: escrow.contract_address,
        routeMode: row.route_mode,
        walletAddress: row.wallet_address,
        destinationTransactionHash: row.destination_transaction_hash,
        preBalanceBaseUnits: BigInt(row.pre_balance_base_units),
      });
      const grossBaseUnits = BigInt(row.gross_amount_base_units);
      const feeReserveBaseUnits = BigInt(row.estimated_fee_reserve_base_units);
      const minimumNetBaseUnits =
        grossBaseUnits > feeReserveBaseUnits ? grossBaseUnits - feeReserveBaseUnits : 0n;
      if (
        destination.netReceivedBaseUnits < minimumNetBaseUnits ||
        destination.netReceivedBaseUnits > grossBaseUnits
      ) {
        throw new ConflictException('funding_net_amount_outside_intent_bounds');
      }
      if (row.status !== 'syncing_pool') {
        if (!(await this.repository.markFundingSyncing(intentId, leaseId))) {
          throw new ConflictException('funding_reconciliation_lease_lost');
        }
      }
      row = await this.requireFundingIntent(programId, intentId);
      circleTransactionId = row.sync_circle_transaction_id;
      if (circleTransactionId === null) {
        const submitted = await this.circle.submitSyncExternalFunding({
          idempotencyKey: row.sync_idempotency_key,
          escrowAddress: escrow.contract_address,
        });
        const stored = await this.repository.storeFundingSyncTransaction(
          intentId,
          submitted.transactionId,
          leaseId,
        );
        if (!stored) {
          const current = await this.requireFundingIntent(programId, intentId);
          if (current.sync_circle_transaction_id !== submitted.transactionId) {
            throw new ConflictException('funding_sync_operation_mismatch');
          }
        }
        circleTransactionId = submitted.transactionId;
      }
      const circleResult = await this.circle.waitForTransaction(circleTransactionId);
      if (circleResult.state === 'failed' || circleResult.transactionHash === undefined) {
        await this.repository.markFundingSyncFailed(
          intentId,
          circleTransactionId,
          circleResult.failureCode ?? 'circle_sync_failed',
          leaseId,
        );
        throw new ServiceUnavailableException('funding_sync_failed');
      }
      const sync = await this.arc.verifyFundingSync({
        escrowAddress: escrow.contract_address,
        transactionHash: circleResult.transactionHash,
        minimumTotalFundedBaseUnits:
          BigInt(row.pre_total_funded_base_units) + destination.netReceivedBaseUnits,
      });
      await this.repository.reconcileFunding({
        intentId,
        leaseId,
        destinationHash: destination.destinationTransactionHash,
        destinationLogIndex: destination.destinationLogIndex,
        destinationBlockNumber: destination.blockNumber,
        destinationBlockHash: destination.blockHash,
        syncHash: sync.transactionHash,
        syncLogIndex: sync.logIndex,
        verifiedNetBaseUnits: destination.netReceivedBaseUnits,
        verifiedPostTotalFundedBaseUnits: sync.totalFundedBaseUnits,
        syncBlockNumber: sync.blockNumber,
        syncBlockHash: sync.blockHash,
      });
      return this.repository.toFundingIntent(
        await this.requireFundingIntent(programId, intentId),
      );
    } catch (error) {
      if (error instanceof EscrowProviderError && error.code === 'funding_destination_reverted') {
        await this.repository.failFundingDestinationReverted(
          intentId,
          row.destination_transaction_hash!,
        );
      } else if (
        error instanceof EscrowProviderError &&
        error.code === 'funding_sync_reverted' &&
        circleTransactionId !== null
      ) {
        await this.repository.markFundingSyncFailed(
          intentId,
          circleTransactionId,
          error.code,
          leaseId,
        );
      }
      this.rethrowProviderError(error);
    }
  }

  public async createWithdrawalIntent(
    principal: RequestPrincipal,
    programId: string,
    input: CreateWithdrawalIntentRequest,
  ): Promise<WithdrawalIntent> {
    await this.requireOwner(principal, programId);
    const escrow = await this.repository.findConfirmedEscrow(programId);
    if (
      escrow === null ||
      escrow.owner_wallet === null ||
      escrow.withdraw_recipient === null ||
      escrow.refund_unlock_at === null
    ) {
      throw new ConflictException('verified_arc_escrow_required');
    }
    if (escrow.owner_wallet.toLowerCase() !== input.walletAddress.toLowerCase()) {
      throw new ConflictException('withdrawal_owner_wallet_mismatch');
    }
    let state;
    try {
      // Keep a contiguous direct-transfer scan cursor separate from normal
      // funding/sync checkpoints. The inclusive one-block overlap is idempotent.
      const deploymentBlock = BigInt(escrow.deployment_block_number ?? '0');
      const persistedCursor = BigInt(
        escrow.late_funding_scanned_through_block ?? escrow.deployment_block_number ?? '0',
      );
      const scanFrom =
        persistedCursor > deploymentBlock ? persistedCursor - 1n : deploymentBlock;
      const lateFunding = await this.arc.findLateFunding({
        escrowAddress: escrow.contract_address,
        fromBlock: scanFrom,
      });
      for (let offset = 0; offset < lateFunding.events.length; offset += LATE_FUNDING_BATCH_SIZE) {
        await this.repository.reconcileLateFunding({
          actorId: principal.userId,
          programId,
          escrowId: escrow.id,
          scannedThroughBlock: lateFunding.scannedThroughBlock,
          events: lateFunding.events.slice(offset, offset + LATE_FUNDING_BATCH_SIZE),
          advanceCursor: false,
        });
      }
      // Advance only after every contiguous event batch succeeds. A crash before
      // this write leaves the old inclusive cursor, so the next scan safely dedupes.
      await this.repository.reconcileLateFunding({
        actorId: principal.userId,
        programId,
        escrowId: escrow.id,
        scannedThroughBlock: lateFunding.scannedThroughBlock,
        events: [],
        advanceCursor: true,
      });
      state = await this.arc.getWithdrawalState(escrow.contract_address);
    } catch (error) {
      this.rethrowProviderError(error);
    }
    if (state.refundUnlockAt > BigInt(Math.floor(Date.now() / 1000))) {
      throw new ConflictException('withdrawal_refund_unlock_not_reached');
    }
    if (state.totalApprovedOutstandingBaseUnits !== 0n) {
      throw new ConflictException('withdrawal_outstanding_rewards_exist');
    }
    if (state.balanceBaseUnits <= 0n) {
      throw new ConflictException('withdrawal_no_remaining_funds');
    }
    if (
      state.withdrawRecipient.toLowerCase() !== escrow.withdraw_recipient.toLowerCase()
    ) {
      throw new ConflictException('withdrawal_recipient_mismatch');
    }
    return this.repository.toWithdrawalIntent(
      await this.repository.createWithdrawalIntent({
        actorId: principal.userId,
        programId,
        idempotencyKey: input.idempotencyKey,
        walletAddress: input.walletAddress,
        amountBaseUnits: state.balanceBaseUnits,
        preTotalWithdrawnBaseUnits: state.totalWithdrawnBaseUnits,
        escrowAlreadyClosed: state.closed,
      }),
    );
  }

  public async getActiveWithdrawalIntent(
    principal: RequestPrincipal,
    programId: string,
  ): Promise<WithdrawalIntent> {
    await this.requireOwner(principal, programId);
    const row = await this.repository.findActiveWithdrawalIntent(programId);
    if (row === null) throw new NotFoundException();
    return this.repository.toWithdrawalIntent(row);
  }

  public async getWithdrawalIntent(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
  ): Promise<WithdrawalIntent> {
    await this.requireOwner(principal, programId);
    return this.repository.toWithdrawalIntent(
      await this.requireWithdrawalIntent(programId, intentId),
    );
  }

  public async observeWithdrawal(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
    input: ObserveWithdrawalRequest,
  ): Promise<WithdrawalIntent> {
    await this.requireOwner(principal, programId);
    await this.requireWithdrawalIntent(programId, intentId);
    await this.repository.observeWithdrawalOperation(intentId, input);
    return this.repository.toWithdrawalIntent(
      await this.requireWithdrawalIntent(programId, intentId),
    );
  }

  public async reconcileWithdrawal(
    principal: RequestPrincipal,
    programId: string,
    intentId: string,
  ): Promise<WithdrawalIntent> {
    await this.requireOwner(principal, programId);
    let row = await this.requireWithdrawalIntent(programId, intentId);
    if (row.status === 'complete') return this.repository.toWithdrawalIntent(row);
    const escrow = await this.repository.findConfirmedEscrow(programId);
    if (escrow === null || escrow.id !== row.escrow_contract_id || escrow.owner_wallet === null) {
      throw new ConflictException('verified_arc_escrow_required');
    }
    try {
      if (row.close_required && row.close_transaction_hash === null) {
        throw new ConflictException('withdrawal_close_not_submitted');
      }
      if (row.close_required && row.status === 'close_submitted') {
        const close = await this.arc.verifyClose({
          escrowAddress: escrow.contract_address,
          ownerWallet: escrow.owner_wallet,
          transactionHash: row.close_transaction_hash!,
        });
        if (!(await this.repository.confirmWithdrawalClose(intentId, close))) {
          throw new ConflictException('withdrawal_close_transition_conflict');
        }
        row = await this.requireWithdrawalIntent(programId, intentId);
      }
      if (row.withdraw_transaction_hash === null) {
        return this.repository.toWithdrawalIntent(row);
      }
      const withdrawal = await this.arc.verifyWithdrawal({
        escrowAddress: escrow.contract_address,
        recipientAddress: row.recipient_address,
        transactionHash: row.withdraw_transaction_hash,
        expectedAmountBaseUnits: BigInt(row.amount_base_units),
        preTotalWithdrawnBaseUnits: BigInt(row.pre_total_withdrawn_base_units),
      });
      if (!(await this.repository.reconcileWithdrawal({ intentId, ...withdrawal }))) {
        throw new ConflictException('withdrawal_reconciliation_conflict');
      }
      return this.repository.toWithdrawalIntent(
        await this.requireWithdrawalIntent(programId, intentId),
      );
    } catch (error) {
      if (error instanceof EscrowProviderError && !error.retryable) {
        const transactionHash =
          row.withdraw_transaction_hash ?? row.close_transaction_hash;
        if (transactionHash !== null) {
          await this.repository.failWithdrawalIntent(intentId, transactionHash, error.code);
        }
      }
      this.rethrowProviderError(error);
    }
  }

  private async requireOwner(principal: RequestPrincipal, programId: string): Promise<void> {
    if (principal.role !== 'owner') throw new ForbiddenException();
    if (!(await this.repository.isProgramOwner(programId, principal.userId))) {
      throw new NotFoundException();
    }
  }

  private async evaluateGatewayFundingReadiness(
    intent: FundingIntentRow,
  ): Promise<GatewayFundingReadiness> {
    const feeReserve = BigInt(intent.estimated_fee_reserve_base_units);
    const feeByNetwork = new Map(
      intent.fee_allocations.map((allocation) => [
        allocation.network,
        BigInt(allocation.amountBaseUnits),
      ]),
    );
    const balances = await Promise.all(
      intent.sources.map(({ network }) =>
        this.arc.getGatewayConfirmedBalance(network, intent.wallet_address),
      ),
    );
    const sources = intent.sources.map((source, index) => {
      const allocation = BigInt(source.amountBaseUnits);
      const sourceFee = feeByNetwork.get(source.network) ?? 0n;
      const required = allocation + sourceFee;
      const confirmed = balances[index] ?? 0n;
      const deficit = required > confirmed ? required - confirmed : 0n;
      return {
        network: source.network,
        hasFeeHeadroom: sourceFee > 0n,
        allocation: formatUsdcBaseUnits(allocation),
        feeReserve: formatUsdcBaseUnits(sourceFee),
        requiredConfirmed: formatUsdcBaseUnits(required),
        confirmed: formatUsdcBaseUnits(confirmed),
        deficit: formatUsdcBaseUnits(deficit),
      };
    });
    const requiredConfirmedTotal =
      BigInt(intent.gross_amount_base_units) + feeReserve;
    const confirmedSelectedTotal = balances.reduce((sum, value) => sum + value, 0n);
    return {
      intentId: intent.id,
      ready: sources.every(({ deficit }) => parseUsdcBaseUnits(deficit) === 0n),
      requiredConfirmedTotal: formatUsdcBaseUnits(requiredConfirmedTotal),
      confirmedSelectedTotal: formatUsdcBaseUnits(confirmedSelectedTotal),
      sources,
    };
  }

  private async requireFundingIntent(
    programId: string,
    intentId: string,
  ): Promise<FundingIntentRow> {
    const row = await this.repository.findFundingIntentRow(programId, intentId);
    if (row === null) throw new NotFoundException();
    return row;
  }

  private async requireWithdrawalIntent(
    programId: string,
    intentId: string,
  ): Promise<WithdrawalIntentRow> {
    const row = await this.repository.findWithdrawalIntentRow(programId, intentId);
    if (row === null) throw new NotFoundException();
    return row;
  }

  private assertDeploymentParameters(
    deployment: EscrowDeploymentRow,
    input: DeployEscrowWithCircleRequest,
    programKey: Hex,
    artifact: EscrowArtifact,
  ): void {
    if (
      typeof deployment.program_key !== 'string' ||
      typeof deployment.owner_wallet !== 'string' ||
      typeof deployment.withdraw_recipient !== 'string' ||
      typeof deployment.refund_unlock_at !== 'string' ||
      typeof deployment.artifact_checksum !== 'string' ||
      deployment.program_key.toLowerCase() !== programKey.toLowerCase() ||
      deployment.owner_wallet.toLowerCase() !== input.ownerWallet.toLowerCase() ||
      deployment.withdraw_recipient.toLowerCase() !== input.withdrawRecipient.toLowerCase() ||
      deployment.refund_unlock_at !== input.refundUnlockAt ||
      deployment.artifact_checksum.toLowerCase() !== artifact.artifactSha256.toLowerCase()
    ) {
      throw new ConflictException('escrow_deployment_parameters_locked');
    }
  }

  private rethrowProviderError(error: unknown): never {
    if (error instanceof EscrowProviderError) {
      if (error.retryable) throw new ServiceUnavailableException(error.code);
      throw new ConflictException(error.code);
    }
    throw error;
  }
}
