import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  escrowDeploymentSchema,
  formatUsdcBaseUnits,
  fundingIntentSchema,
  withdrawalIntentSchema,
  rewardSettlementIntentSchema,
  type FundingIntent,
  type FundingConfirmationArtifact,
  type FundingSource,
  type FundingNetworkId,
  type FundingFeeComponentType,
  type ObserveSourceDepositRequest,
  type SourceDeposit,
  type ObserveFundingOperationRequest,
  type ObserveWithdrawalRequest,
  type AttachFundingRecoveryTelemetryRequest,
  type EscrowDeployment,
  type WithdrawalIntent,
  type RewardSettlementIntent,
} from '@bug-bounty-escrow/shared';

import { RepositoryBase, type DatabaseResult } from '../database/repository.base.js';
import { SUPABASE_CLIENT } from '../database/supabase.provider.js';
import type {
  GatewaySubscriptionRegistrationStore,
  PreparedGatewaySubscriptionRegistration,
} from './gateway-subscription-registration.store.js';

export interface ConfirmedEscrowRow {
  id: string;
  program_id: string;
  contract_address: `0x${string}`;
  token_address: `0x${string}` | null;
  owner_wallet: `0x${string}` | null;
  withdraw_recipient: `0x${string}` | null;
  refund_unlock_at: string | null;
  deployment_block_number: string | null;
  last_synced_block: string | null;
  late_funding_scanned_through_block: string | null;
  program_key: `0x${string}` | null;
  contract_version: string | null;
  artifact_checksum: `0x${string}` | null;
  runtime_bytecode_checksum: `0x${string}` | null;
}

export interface EscrowWalletChallengeRow {
  id: string;
  program_id: string;
  actor_id: string;
  owner_wallet: `0x${string}`;
  withdraw_recipient: `0x${string}`;
  chain_id: 5_042_002;
  nonce: `0x${string}`;
  issued_at: string;
  expires_at: string;
  invalidated_at: string | null;
  consumed_at: string | null;
  deployment_id: string | null;
}

export interface FundingFeeAllocationRow {
  network: FundingSource['network'];
  amountBaseUnits: string;
  components: {
    network: FundingSource['network'];
    type: FundingFeeComponentType;
    token: 'USDC';
    amountBaseUnits: string;
  }[];
}

export interface FundingIntentRow {
  id: string;
  program_id: string;
  escrow_contract_id: string;
  wallet_address: `0x${string}`;
  route_mode: 'send' | 'bridge' | 'unified_balance';
  gross_amount_base_units: string;
  estimated_fee_reserve_base_units: string;
  fee_allocations: FundingFeeAllocationRow[];
  quote_quoted_at?: string | null;
  quote_expires_at?: string | null;
  sources: { network: FundingSource['network']; amountBaseUnits: string }[];
  destination_address: `0x${string}`;
  pre_balance_base_units: string;
  pre_total_funded_base_units: string;
  funding_phase: FundingIntent['fundingPhase'];
  status: FundingIntent['status'];
  destination_transaction_hash: `0x${string}` | null;
  transfer_id: string | null;
  net_received_base_units: string | null;
  failure_code: string | null;
  expires_at: string;
  sync_idempotency_key: string;
  sync_circle_transaction_id: string | null;
  created_at: string;
  updated_at: string;
  funding_operations?: SourceDepositOperationRow[];
  funding_confirmation_artifacts?: FundingConfirmationArtifactRow | null;
  recovery_attempts_total?: number;
  source_deposits_total?: number;
}

export interface FundingConfirmationArtifactRow {
  funding_intent_id: string;
  program_id: string;
  escrow_contract_id: string;
  route_mode: FundingIntent['routeMode'];
  escrow_address: `0x${string}`;
  artifact_version: '1.1.0';
  artifact_checksum: `0x${string}`;
  token_address: typeof import('@bug-bounty-escrow/shared').ARC_TESTNET_USDC_ADDRESS;
  token_decimals: 6;
  destination_transaction_hash: `0x${string}`;
  destination_log_index: number;
  destination_block_number: string;
  destination_block_hash: `0x${string}`;
  sync_transaction_hash: `0x${string}`;
  sync_log_index: number | null;
  sync_block_number: string;
  sync_block_hash: `0x${string}`;
  gross_amount_base_units: string;
  estimated_fee_reserve_base_units: string;
  net_received_base_units: string;
  pre_total_funded_base_units: string;
  required_total_funded_base_units: string;
  post_total_funded_base_units: string;
  total_pool: string;
  reserved_pool: string;
  paid_pool: string;
  withdrawn_pool: string;
  available_pool: string;
  reconciled_at: string;
}

export interface SourceDepositOperationRow {
  id?: string;
  funding_intent_id?: string;
  attempt_no?: number;
  replaces_operation_id?: string | null;
  idempotency_key?: string;
  operation_type?: 'deposit' | 'send' | 'bridge' | 'spend' | 'funding_sync';
  operation_id?: string | null;
  source_chain?: FundingNetworkId | null;
  source_chain_id?: string | null;
  source_address?: `0x${string}` | null;
  source_token_address?: `0x${string}` | null;
  gateway_wallet_address?: `0x${string}` | null;
  requested_amount_base_units?: string | null;
  pre_gateway_balance_base_units?: string | null;
  transaction_hash?: `0x${string}` | null;
  transfer_id?: string | null;
  log_index?: number | null;
  transfer_log_index?: number | null;
  block_number?: string | null;
  block_hash?: `0x${string}` | null;
  status?:
    | 'awaiting_signature'
    | 'submitted'
    | 'pending'
    | 'submission_uncertain'
    | 'onchain_verified'
    | 'gateway_finalized'
    | 'confirmed'
    | 'failed';
  failure_code?: string | null;
  recovery_checked_at?: string | null;
  recovery_transaction_hash?: `0x${string}` | null;
  recovery_state?: 'pending' | 'success' | 'reverted' | null;
  recovery_block_number?: string | null;
  recovery_block_hash?: `0x${string}` | null;
  unbound_transaction_hashes?: `0x${string}`[];
  funding_operation_recovery_checks?: FundingOperationRecoveryCheckRow[];
  provider_state: 'pending' | 'success' | 'error' | null;
  retryable: boolean;
  submission_uncertain: boolean;
  steps: {
    name: string;
    state: 'pending' | 'success' | 'error';
    network?: FundingNetworkId;
    transactionHash?: string;
    errorCode?: string;
  }[];
  created_at?: string;
  updated_at: string;
}

export interface FundingOperationRecoveryCheckRow {
  funding_operation_id: string;
  transaction_hash: `0x${string}`;
  evidence_role: 'source' | 'destination';
  network: FundingNetworkId;
  state: 'pending' | 'success' | 'reverted';
  block_number: string | null;
  block_hash: `0x${string}` | null;
  checked_at: string;
}

export interface EscrowDeploymentRow {
  id: string;
  program_id: string;
  program_key: `0x${string}`;
  chain_id: number;
  token_address: `0x${string}`;
  owner_wallet: `0x${string}`;
  withdraw_recipient: `0x${string}`;
  refund_unlock_at: string;
  contract_version: '1.1.0';
  artifact_checksum: `0x${string}`;
  circle_contract_id: string | null;
  circle_transaction_id: string | null;
  deploy_idempotency_key: string;
  deployment_status: EscrowDeployment['status'];
  contract_address: `0x${string}` | null;
  deployment_transaction_hash: `0x${string}` | null;
  failure_code: string | null;
  updated_at: string;
}

export interface WithdrawalIntentRow {
  id: string;
  program_id: string;
  escrow_contract_id: string;
  replaces_intent_id: string | null;
  replaced_by_intent_id: string | null;
  wallet_address: `0x${string}`;
  recipient_address: `0x${string}`;
  amount_base_units: string;
  pre_total_withdrawn_base_units: string;
  close_required: boolean;
  status: WithdrawalIntent['status'];
  close_transaction_hash: `0x${string}` | null;
  withdraw_transaction_hash: `0x${string}` | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  escrow_contracts?: { contract_address: `0x${string}` | null } | null;
}

export interface RewardSettlementOperationRow {
  id: string;
  operation_type: 'approval' | 'payout';
  attempt_no: number;
  status: 'submission_uncertain' | 'provider_accepted' | 'submitted' | 'confirmed' | 'failed';
  provider_idempotency_key: string | null;
  circle_transaction_id: string | null;
  transaction_hash: `0x${string}` | null;
  event_log_index: number | null;
  transfer_log_index: number | null;
  block_number: string | null;
  block_hash: `0x${string}` | null;
  failure_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface RewardSettlementIntentRow {
  id: string;
  report_id: string;
  program_id: string;
  escrow_contract_id: string;
  owner_wallet: `0x${string}`;
  report_key: `0x${string}`;
  approved_content_hash: `0x${string}`;
  recipient_address: `0x${string}`;
  calculation_type: 'range' | 'flat' | 'percentage';
  calculation_basis_base_units: string | null;
  percentage_bps: number | null;
  max_reward_cap_base_units: string | null;
  amount_base_units: string;
  amount: string | number;
  status: RewardSettlementIntent['status'];
  failure_code: string | null;
  created_at: string;
  updated_at: string;
  escrow_contracts: {
    contract_address: `0x${string}` | null;
    deployment_block_number: string | null;
  } | null;
  reward_settlement_operations?: RewardSettlementOperationRow[];
}

export interface RewardSettlementContextRow {
  id: string;
  program_id: string;
  content_hash: `0x${string}`;
}

function mapFundingIntent(row: FundingIntentRow): FundingIntent {
  const mapRecoveryChecks = (operation: SourceDepositOperationRow) =>
    [...(operation.funding_operation_recovery_checks ?? [])]
      .sort(
        (left, right) =>
          left.checked_at.localeCompare(right.checked_at) ||
          left.transaction_hash.localeCompare(right.transaction_hash) ||
          left.evidence_role.localeCompare(right.evidence_role) ||
          left.network.localeCompare(right.network),
      )
      .map((check) => ({
        transactionHash: check.transaction_hash,
        evidenceRole: check.evidence_role,
        network: check.network,
        state: check.state,
        ...(check.block_number === null ? {} : { blockNumber: check.block_number }),
        ...(check.block_hash === null ? {} : { blockHash: check.block_hash }),
        checkedAt: check.checked_at,
      }));
  const recoveryOperations = [...(row.funding_operations ?? [])]
    .filter((operation) => operation.operation_type !== 'deposit')
    .sort((left, right) => {
      const createdOrder = (left.created_at ?? left.updated_at).localeCompare(
        right.created_at ?? right.updated_at,
      );
      if (createdOrder !== 0) return createdOrder;
      const attemptOrder = (left.attempt_no ?? 1) - (right.attempt_no ?? 1);
      return attemptOrder !== 0
        ? attemptOrder
        : (left.operation_type ?? '').localeCompare(right.operation_type ?? '') ||
            (left.id ?? '').localeCompare(right.id ?? '');
    });
  // Recovery always follows the newest non-terminal linked attempt. Polling an older failed
  // attempt updates its timestamp, but must never make it shadow a newer replacement.
  const recoveryOperation =
    [...recoveryOperations]
      .filter((operation) => operation.status !== 'failed' && operation.status !== 'confirmed')
      .sort((left, right) => {
        const attemptOrder = (right.attempt_no ?? 1) - (left.attempt_no ?? 1);
        return attemptOrder !== 0
          ? attemptOrder
          : (right.created_at ?? right.updated_at).localeCompare(
              left.created_at ?? left.updated_at,
            ) ||
              (right.operation_type ?? '').localeCompare(left.operation_type ?? '') ||
              (right.id ?? '').localeCompare(left.id ?? '');
      })[0] ??
    [...recoveryOperations].sort((left, right) => {
      const attemptOrder = (right.attempt_no ?? 1) - (left.attempt_no ?? 1);
      return attemptOrder !== 0
        ? attemptOrder
        : right.updated_at.localeCompare(left.updated_at) ||
            (right.operation_type ?? '').localeCompare(left.operation_type ?? '') ||
            (right.id ?? '').localeCompare(left.id ?? '');
    })[0];
  const mapRecoveryOperation = (operation: SourceDepositOperationRow) => {
    const recoverySteps = operation.steps.slice(0, 32);
    const destinationHash = operation.transaction_hash?.toLowerCase();
    const sourceTransactionHashes = [
      ...new Map(
        recoverySteps.flatMap((step) =>
          step.transactionHash !== undefined &&
          /^0x[0-9a-fA-F]{64}$/.test(step.transactionHash) &&
          step.transactionHash.toLowerCase() !== destinationHash
            ? [[step.transactionHash.toLowerCase(), step.transactionHash] as const]
            : [],
        ),
      ).values(),
    ];
    return {
      operationRecordId: operation.id!,
      operationType: operation.operation_type as 'send' | 'bridge' | 'spend' | 'funding_sync',
      attemptNo: operation.attempt_no ?? 1,
      status: operation.status!,
      ...(operation.replaces_operation_id == null
        ? {}
        : { replacesOperationId: operation.replaces_operation_id }),
      ...(operation.operation_id == null
        ? {}
        : { operationId: operation.operation_id.replace(/^client:/, '') }),
      ...(operation.transaction_hash == null
        ? {}
        : { transactionHash: operation.transaction_hash }),
      ...(operation.transfer_id == null ? {} : { transferId: operation.transfer_id }),
      ...(operation.failure_code == null ? {} : { failureCode: operation.failure_code }),
      ...(operation.provider_state === null ? {} : { providerState: operation.provider_state }),
      ...(operation.recovery_checked_at == null
        ? {}
        : { recoveryCheckedAt: operation.recovery_checked_at }),
      ...(operation.recovery_transaction_hash == null
        ? {}
        : { recoveryTransactionHash: operation.recovery_transaction_hash }),
      ...(operation.recovery_state == null ? {} : { recoveryState: operation.recovery_state }),
      ...(operation.recovery_block_number == null
        ? {}
        : { recoveryBlockNumber: operation.recovery_block_number }),
      ...(operation.recovery_block_hash == null
        ? {}
        : { recoveryBlockHash: operation.recovery_block_hash }),
      ...(mapRecoveryChecks(operation).length === 0
        ? {}
        : { recoveryChecks: mapRecoveryChecks(operation) }),
      ...((operation.unbound_transaction_hashes?.length ?? 0) === 0
        ? {}
        : { unboundTransactionHashes: operation.unbound_transaction_hashes }),
      retryable: operation.retryable,
      submissionUncertain: operation.submission_uncertain,
      sourceTransactionHashes,
      steps: recoverySteps,
      ...(operation.created_at === undefined ? {} : { createdAt: operation.created_at }),
      updatedAt: operation.updated_at,
    };
  };
  return fundingIntentSchema.parse({
    id: row.id,
    programId: row.program_id,
    walletAddress: row.wallet_address,
    routeMode: row.route_mode,
    grossAmount: formatUsdcBaseUnits(BigInt(row.gross_amount_base_units)),
    estimatedFeeReserve: formatUsdcBaseUnits(BigInt(row.estimated_fee_reserve_base_units)),
    feeAllocations: row.fee_allocations.map((allocation) => ({
      network: allocation.network,
      amount: formatUsdcBaseUnits(BigInt(allocation.amountBaseUnits)),
      components: allocation.components.map((component) => ({
        network: component.network,
        type: component.type,
        token: component.token,
        amount: formatUsdcBaseUnits(BigInt(component.amountBaseUnits)),
      })),
    })),
    ...(row.quote_quoted_at == null ? {} : { quoteQuotedAt: row.quote_quoted_at }),
    ...(row.quote_expires_at == null ? {} : { quoteExpiresAt: row.quote_expires_at }),
    sources: row.sources.map((source) => ({
      network: source.network,
      amount: formatUsdcBaseUnits(BigInt(source.amountBaseUnits)),
    })),
    sourceDeposits: (row.funding_operations ?? [])
      .filter((operation) => operation.operation_type === 'deposit')
      .map((operation) => ({
        id: operation.id!,
        attemptNo: operation.attempt_no!,
        ...(operation.replaces_operation_id == null
          ? {}
          : { replacesDepositId: operation.replaces_operation_id }),
        network: operation.source_chain!,
        chainId: Number(operation.source_chain_id),
        tokenAddress: operation.source_token_address!,
        gatewayWalletAddress: operation.gateway_wallet_address!,
        walletAddress: operation.source_address!,
        amount: formatUsdcBaseUnits(BigInt(operation.requested_amount_base_units!)),
        preGatewayBalance: formatUsdcBaseUnits(BigInt(operation.pre_gateway_balance_base_units!)),
        status: operation.status as SourceDeposit['status'],
        ...(operation.transaction_hash === null
          ? {}
          : { transactionHash: operation.transaction_hash }),
        ...(operation.log_index === null ? {} : { logIndex: operation.log_index }),
        ...(operation.transfer_log_index === null
          ? {}
          : { transferLogIndex: operation.transfer_log_index }),
        ...(operation.block_number === null ? {} : { blockNumber: operation.block_number }),
        ...(operation.block_hash === null ? {} : { blockHash: operation.block_hash }),
        ...(operation.failure_code === null ? {} : { failureCode: operation.failure_code }),
        ...(operation.recovery_checked_at == null
          ? {}
          : { recoveryCheckedAt: operation.recovery_checked_at }),
        ...(operation.recovery_transaction_hash == null
          ? {}
          : { recoveryTransactionHash: operation.recovery_transaction_hash }),
        ...(operation.recovery_state == null ? {} : { recoveryState: operation.recovery_state }),
        ...(operation.recovery_block_number == null
          ? {}
          : { recoveryBlockNumber: operation.recovery_block_number }),
        ...(operation.recovery_block_hash == null
          ? {}
          : { recoveryBlockHash: operation.recovery_block_hash }),
        ...(mapRecoveryChecks(operation).length === 0
          ? {}
          : { recoveryChecks: mapRecoveryChecks(operation) }),
        canAttach: true,
        canRetry:
          operation.status === 'failed' &&
          operation.failure_code === 'server.source_deposit_reverted',
        createdAt: operation.created_at!,
        updatedAt: operation.updated_at,
      })),
    ...(row.source_deposits_total === undefined
      ? {}
      : {
          sourceDepositsTotal: row.source_deposits_total,
          sourceDepositsTruncated:
            row.source_deposits_total >
            (row.funding_operations ?? []).filter(
              (operation) => operation.operation_type === 'deposit',
            ).length,
        }),
    fundingPhase: row.funding_phase,
    destinationChain: 'Arc_Testnet',
    recipientAddress: row.destination_address,
    recipientVerified: true,
    status: row.status,
    ...(row.destination_transaction_hash === null
      ? {}
      : { destinationTransactionHash: row.destination_transaction_hash }),
    ...(row.transfer_id === null ? {} : { transferId: row.transfer_id }),
    ...(row.net_received_base_units === null
      ? {}
      : { netReceivedAmount: formatUsdcBaseUnits(BigInt(row.net_received_base_units)) }),
    ...(row.funding_confirmation_artifacts == null
      ? {}
      : {
          confirmationArtifact: mapFundingConfirmationArtifact(row.funding_confirmation_artifacts),
        }),
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    ...(recoveryOperation === undefined
      ? {}
      : {
          recovery: mapRecoveryOperation(recoveryOperation),
        }),
    ...(recoveryOperations.length === 0
      ? {}
      : { recoveryAttempts: recoveryOperations.map(mapRecoveryOperation) }),
    ...(row.recovery_attempts_total === undefined
      ? {}
      : {
          recoveryAttemptsTotal: row.recovery_attempts_total,
          recoveryAttemptsTruncated: row.recovery_attempts_total > recoveryOperations.length,
        }),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapFundingConfirmationArtifact(
  row: FundingConfirmationArtifactRow,
): FundingConfirmationArtifact {
  return {
    fundingIntentId: row.funding_intent_id,
    programId: row.program_id,
    routeMode: row.route_mode,
    escrowAddress: row.escrow_address,
    artifactVersion: row.artifact_version,
    artifactChecksum: row.artifact_checksum,
    tokenAddress: row.token_address,
    tokenDecimals: row.token_decimals,
    destinationTransactionHash: row.destination_transaction_hash,
    destinationLogIndex: row.destination_log_index,
    destinationBlockNumber: row.destination_block_number,
    destinationBlockHash: row.destination_block_hash,
    syncTransactionHash: row.sync_transaction_hash,
    ...(row.sync_log_index === null ? {} : { syncLogIndex: row.sync_log_index }),
    syncBlockNumber: row.sync_block_number,
    syncBlockHash: row.sync_block_hash,
    grossAmount: formatUsdcBaseUnits(BigInt(row.gross_amount_base_units)),
    estimatedFeeReserve: formatUsdcBaseUnits(BigInt(row.estimated_fee_reserve_base_units)),
    netReceivedAmount: formatUsdcBaseUnits(BigInt(row.net_received_base_units)),
    preTotalFundedAmount: formatUsdcBaseUnits(BigInt(row.pre_total_funded_base_units)),
    requiredTotalFundedAmount: formatUsdcBaseUnits(BigInt(row.required_total_funded_base_units)),
    postTotalFundedAmount: formatUsdcBaseUnits(BigInt(row.post_total_funded_base_units)),
    accounting: {
      totalPool: row.total_pool,
      totalPaid: row.paid_pool,
      totalWithdrawn: row.withdrawn_pool,
      approvedOutstanding: row.reserved_pool,
      availablePool: row.available_pool,
    },
    reconciledAt: row.reconciled_at,
  };
}

function mapEscrowDeployment(row: EscrowDeploymentRow): EscrowDeployment {
  if (row.circle_contract_id === null || row.circle_transaction_id === null) {
    throw new Error('circle_deployment_identifiers_missing');
  }
  return escrowDeploymentSchema.parse({
    programId: row.program_id,
    programKey: row.program_key,
    chainId: 5_042_002,
    tokenAddress: row.token_address,
    ownerWallet: row.owner_wallet,
    withdrawRecipient: row.withdraw_recipient,
    refundUnlockAt: row.refund_unlock_at,
    artifactVersion: row.contract_version,
    artifactChecksum: row.artifact_checksum,
    circleContractId: row.circle_contract_id,
    circleTransactionId: row.circle_transaction_id,
    status: row.deployment_status,
    ...(row.contract_address === null ? {} : { contractAddress: row.contract_address }),
    ...(row.deployment_transaction_hash === null
      ? {}
      : { transactionHash: row.deployment_transaction_hash }),
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    updatedAt: row.updated_at,
  });
}

function mapWithdrawalIntent(row: WithdrawalIntentRow): WithdrawalIntent {
  return withdrawalIntentSchema.parse({
    id: row.id,
    programId: row.program_id,
    escrowAddress: row.escrow_contracts?.contract_address,
    recipientAddress: row.recipient_address,
    walletAddress: row.wallet_address,
    amount: formatUsdcBaseUnits(BigInt(row.amount_base_units)),
    closeRequired: row.close_required,
    ...(row.replaces_intent_id === null ? {} : { replacesIntentId: row.replaces_intent_id }),
    ...(row.replaced_by_intent_id === null
      ? {}
      : { replacedByIntentId: row.replaced_by_intent_id }),
    status: row.status,
    ...(row.close_transaction_hash === null
      ? {}
      : { closeTransactionHash: row.close_transaction_hash }),
    ...(row.withdraw_transaction_hash === null
      ? {}
      : { withdrawTransactionHash: row.withdraw_transaction_hash }),
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function mapRewardSettlementIntent(row: RewardSettlementIntentRow): RewardSettlementIntent {
  return rewardSettlementIntentSchema.parse({
    id: row.id,
    reportId: row.report_id,
    programId: row.program_id,
    escrowAddress: row.escrow_contracts?.contract_address,
    ownerWallet: row.owner_wallet,
    reportKey: row.report_key,
    approvedContentHash: row.approved_content_hash,
    recipientAddress: row.recipient_address,
    calculationType: row.calculation_type,
    ...(row.calculation_basis_base_units === null
      ? {}
      : {
          calculationBasisAmount: formatUsdcBaseUnits(BigInt(row.calculation_basis_base_units)),
        }),
    ...(row.percentage_bps === null ? {} : { percentageBps: row.percentage_bps }),
    ...(row.max_reward_cap_base_units === null
      ? {}
      : {
          maxRewardCap: formatUsdcBaseUnits(BigInt(row.max_reward_cap_base_units)),
        }),
    amount: formatUsdcBaseUnits(BigInt(row.amount_base_units)),
    status: row.status,
    ...(row.failure_code === null ? {} : { failureCode: row.failure_code }),
    operations: [...(row.reward_settlement_operations ?? [])]
      .sort((left, right) => left.attempt_no - right.attempt_no)
      .map((operation) => ({
        id: operation.id,
        operationType: operation.operation_type,
        attemptNo: operation.attempt_no,
        status: operation.status,
        ...(operation.circle_transaction_id === null
          ? {}
          : { circleTransactionId: operation.circle_transaction_id }),
        ...(operation.transaction_hash === null
          ? {}
          : { transactionHash: operation.transaction_hash }),
        ...(operation.event_log_index === null ? {} : { eventLogIndex: operation.event_log_index }),
        ...(operation.transfer_log_index === null
          ? {}
          : { transferLogIndex: operation.transfer_log_index }),
        ...(operation.block_number === null ? {} : { blockNumber: operation.block_number }),
        ...(operation.block_hash === null ? {} : { blockHash: operation.block_hash }),
        ...(operation.failure_code === null ? {} : { failureCode: operation.failure_code }),
        createdAt: operation.created_at,
        updatedAt: operation.updated_at,
      })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

@Injectable()
export class EscrowRepository
  extends RepositoryBase
  implements GatewaySubscriptionRegistrationStore
{
  public constructor(@Inject(SUPABASE_CLIENT) client: SupabaseClient) {
    super(client);
  }

  public async isProgramOwner(programId: string, actorId: string): Promise<boolean> {
    const result = await this.client
      .from('programs')
      .select('id')
      .eq('id', programId)
      .eq('owner_id', actorId)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data !== null;
  }

  public async getProgramDeadline(programId: string): Promise<string | null> {
    const result = await this.client
      .from('programs')
      .select('deadline')
      .eq('id', programId)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return (result.data as { deadline: string | null } | null)?.deadline ?? null;
  }

  public async getProgramStatus(
    programId: string,
  ): Promise<'draft' | 'awaiting_funding' | 'active' | 'paused' | 'expired' | 'closed' | null> {
    const result = await this.client
      .from('programs')
      .select('status')
      .eq('id', programId)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return (
      (
        result.data as {
          status: 'draft' | 'awaiting_funding' | 'active' | 'paused' | 'expired' | 'closed';
        } | null
      )?.status ?? null
    );
  }

  public async createWalletChallenge(input: {
    id: string;
    actorId: string;
    programId: string;
    ownerWallet: string;
    withdrawRecipient: string;
    nonce: string;
    issuedAt: string;
    expiresAt: string;
  }): Promise<EscrowWalletChallengeRow> {
    const id = await this.executeAtomicRpc<string>('create_escrow_wallet_challenge_atomic', {
      target_challenge_id: input.id,
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_owner_wallet: input.ownerWallet.toLowerCase(),
      target_withdraw_recipient: input.withdrawRecipient.toLowerCase(),
      target_nonce: input.nonce.toLowerCase(),
      target_issued_at: input.issuedAt,
      target_expires_at: input.expiresAt,
    });
    const row = await this.findWalletChallenge(id);
    if (row === null) throw new Error('wallet_control_challenge_not_found_after_create');
    return row;
  }

  public async findWalletChallenge(challengeId: string): Promise<EscrowWalletChallengeRow | null> {
    const result = await this.client
      .from('escrow_wallet_control_challenges')
      .select(
        'id,program_id,actor_id,owner_wallet,withdraw_recipient,chain_id,nonce,issued_at,expires_at,invalidated_at,consumed_at,deployment_id',
      )
      .eq('id', challengeId)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as EscrowWalletChallengeRow | null;
  }

  public async findConfirmedEscrow(programId: string): Promise<ConfirmedEscrowRow | null> {
    const result = await this.client
      .from('escrow_contracts')
      .select(
        'id,program_id,contract_address,token_address,owner_wallet,withdraw_recipient,refund_unlock_at,deployment_block_number,last_synced_block,late_funding_scanned_through_block,program_key,contract_version,artifact_checksum,runtime_bytecode_checksum',
      )
      .eq('program_id', programId)
      .eq('chain_id', 5_042_002)
      .eq('deployment_status', 'confirmed')
      .eq('token_address', '0x3600000000000000000000000000000000000000')
      .eq('contract_version', '1.1.0')
      .not('token_address', 'is', null)
      .not('owner_wallet', 'is', null)
      .not('withdraw_recipient', 'is', null)
      .not('refund_unlock_at', 'is', null)
      .not('program_key', 'is', null)
      .not('artifact_checksum', 'is', null)
      .not('runtime_bytecode_checksum', 'is', null)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as ConfirmedEscrowRow | null;
  }

  public async findDeployment(programId: string): Promise<EscrowDeploymentRow | null> {
    const result = await this.client
      .from('escrow_contracts')
      .select('*')
      .eq('program_id', programId)
      .eq('chain_id', 5_042_002)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as EscrowDeploymentRow | null;
  }

  public async createDeploymentRecord(input: {
    actorId: string;
    programId: string;
    walletChallengeId: string;
    programKey: string;
    ownerWallet: string;
    withdrawRecipient: string;
    refundUnlockAt: string;
    artifactChecksum: string;
    runtimeChecksum: string;
    immutableReferences: unknown;
    idempotencyKey: string;
  }): Promise<EscrowDeploymentRow> {
    const id = await this.executeAtomicRpc<string>(
      'create_escrow_deployment_with_wallet_proof_atomic',
      {
        actor_id: input.actorId,
        target_program_id: input.programId,
        target_wallet_challenge_id: input.walletChallengeId,
        target_program_key: input.programKey.toLowerCase(),
        target_owner_wallet: input.ownerWallet.toLowerCase(),
        target_withdraw_recipient: input.withdrawRecipient.toLowerCase(),
        target_refund_unlock_at: input.refundUnlockAt,
        target_artifact_checksum: input.artifactChecksum.toLowerCase(),
        target_runtime_checksum: input.runtimeChecksum.toLowerCase(),
        target_immutable_references: input.immutableReferences,
        target_idempotency_key: input.idempotencyKey,
      },
    );
    const row = await this.findDeploymentById(id);
    if (row === null) throw new Error('escrow_deployment_not_found_after_create');
    return row;
  }

  public async storeCircleDeploymentIdentifiers(
    deploymentId: string,
    contractId: string,
    transactionId: string,
  ): Promise<EscrowDeploymentRow> {
    const result = await this.client
      .from('escrow_contracts')
      .update({
        circle_contract_id: contractId,
        circle_transaction_id: transactionId,
        deployment_status: 'pending',
      })
      .eq('id', deploymentId)
      .eq('deployment_status', 'accepted')
      .select('*')
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    if (result.data !== null) return result.data as EscrowDeploymentRow;
    const current = await this.findDeploymentById(deploymentId);
    if (
      current === null ||
      current.circle_contract_id !== contractId ||
      current.circle_transaction_id !== transactionId
    ) {
      throw new Error('circle_deployment_transition_conflict');
    }
    return current;
  }

  public async confirmDeployment(
    deploymentId: string,
    input: {
      contractAddress: string;
      transactionHash: string;
      blockNumber: bigint;
      blockHash: string;
      deploymentWalletReference: string;
    },
  ): Promise<EscrowDeploymentRow> {
    await this.executeAtomicRpc<boolean>('confirm_escrow_deployment_atomic', {
      target_deployment_id: deploymentId,
      verified_contract_address: input.contractAddress.toLowerCase(),
      verified_transaction_hash: input.transactionHash.toLowerCase(),
      verified_block_number: input.blockNumber.toString(),
      verified_block_hash: input.blockHash.toLowerCase(),
      verified_deployment_wallet_reference: input.deploymentWalletReference.toLowerCase(),
    });
    const current = await this.findDeploymentById(deploymentId);
    if (current === null) throw new Error('escrow_deployment_transition_conflict');
    return current;
  }

  public async failDeployment(
    deploymentId: string,
    failureCode: string,
  ): Promise<EscrowDeploymentRow> {
    const result = await this.client
      .from('escrow_contracts')
      .update({ deployment_status: 'failed', failure_code: failureCode })
      .eq('id', deploymentId)
      .in('deployment_status', ['accepted', 'pending', 'verifying'])
      .select('*')
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    if (result.data !== null) return result.data as EscrowDeploymentRow;
    const current = await this.findDeploymentById(deploymentId);
    if (current === null) throw new Error('escrow_deployment_transition_conflict');
    return current;
  }

  public toEscrowDeployment(row: EscrowDeploymentRow): EscrowDeployment {
    return mapEscrowDeployment(row);
  }

  private async findDeploymentById(id: string): Promise<EscrowDeploymentRow | null> {
    const result = await this.client
      .from('escrow_contracts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as EscrowDeploymentRow | null;
  }

  public async createFundingIntent(input: {
    actorId: string;
    programId: string;
    idempotencyKey: string;
    walletAddress: string;
    grossBaseUnits: bigint;
    feeReserveBaseUnits: bigint;
    feeAllocations: FundingFeeAllocationRow[];
    sources: { network: FundingSource['network']; amountBaseUnits: string }[];
    preBalanceBaseUnits: bigint;
    preTotalFundedBaseUnits: bigint;
    expiresAt: string;
    quoteQuotedAt: string;
    quoteExpiresAt: string;
  }): Promise<FundingIntentRow> {
    const intentId = await this.executeAtomicRpc<string>('create_funding_intent_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      request_idempotency_key: input.idempotencyKey,
      source_wallet: input.walletAddress.toLowerCase(),
      gross_base_units: input.grossBaseUnits.toString(),
      fee_reserve_base_units: input.feeReserveBaseUnits.toString(),
      requested_fee_allocations: input.feeAllocations,
      requested_sources: input.sources,
      escrow_pre_balance_base_units: input.preBalanceBaseUnits.toString(),
      escrow_pre_total_funded_base_units: input.preTotalFundedBaseUnits.toString(),
      intent_expires_at: input.expiresAt,
      initial_quote_quoted_at: input.quoteQuotedAt,
      initial_quote_expires_at: input.quoteExpiresAt,
    });
    const row = await this.findFundingIntentRow(input.programId, intentId);
    if (row === null) throw new Error('funding_intent_not_found_after_create');
    return row;
  }

  public async findActiveFundingIntent(programId: string): Promise<FundingIntentRow | null> {
    const result = await this.client
      .from('funding_intents')
      .select('*,funding_confirmation_artifacts(*)')
      .eq('program_id', programId)
      .in('status', [
        'ready_to_sign',
        'awaiting_signature',
        'source_submitted',
        'destination_submitted',
        'delivery_pending',
        'verifying_destination',
        'syncing_pool',
        'sync_failed',
      ])
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    const row = result.data as FundingIntentRow | null;
    return row === null ? null : this.attachBoundedFundingOperations(row);
  }

  public async findFundingIntentRow(
    programId: string,
    intentId: string,
  ): Promise<FundingIntentRow | null> {
    const result = await this.client
      .from('funding_intents')
      .select('*,funding_confirmation_artifacts(*)')
      .eq('program_id', programId)
      .eq('id', intentId)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    const row = result.data as FundingIntentRow | null;
    return row === null ? null : this.attachBoundedFundingOperations(row);
  }

  public async listFundingOperationHistory(input: {
    intentId: string;
    page: number;
    limit: number;
    kind: 'all' | 'source_deposit' | 'recovery';
  }): Promise<{ rows: SourceDepositOperationRow[]; total: number }> {
    let query = this.client
      .from('funding_operations')
      .select('*,funding_operation_recovery_checks(*)', { count: 'exact' })
      .eq('funding_intent_id', input.intentId);
    if (input.kind === 'source_deposit') query = query.eq('operation_type', 'deposit');
    if (input.kind === 'recovery') query = query.neq('operation_type', 'deposit');
    const offset = (input.page - 1) * input.limit;
    const result = await query
      .order('created_at', { ascending: false })
      .order('attempt_no', { ascending: false })
      .order('operation_type', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + input.limit - 1);
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return {
      rows: (result.data ?? []) as SourceDepositOperationRow[],
      total: result.count ?? result.data?.length ?? 0,
    };
  }

  public toFundingHistoryItem(
    intent: FundingIntentRow,
    operation: SourceDepositOperationRow,
  ):
    | { kind: 'source_deposit'; data: FundingIntent['sourceDeposits'][number] }
    | { kind: 'recovery'; data: NonNullable<FundingIntent['recovery']> } {
    const historyIntent = { ...intent };
    delete historyIntent.recovery_attempts_total;
    delete historyIntent.source_deposits_total;
    const mapped = mapFundingIntent({
      ...historyIntent,
      funding_operations: [operation],
    });
    if (operation.operation_type === 'deposit') {
      const deposit = mapped.sourceDeposits[0];
      if (deposit === undefined) throw new Error('funding_history_source_projection_failed');
      return { kind: 'source_deposit', data: deposit };
    }
    const recovery = mapped.recoveryAttempts?.[0];
    if (recovery === undefined) throw new Error('funding_history_recovery_projection_failed');
    return { kind: 'recovery', data: recovery };
  }

  private async attachBoundedFundingOperations(row: FundingIntentRow): Promise<FundingIntentRow> {
    const [deposits, activeDeposits, recovery, activeRecovery] = await Promise.all([
      this.client
        .from('funding_operations')
        .select('*', { count: 'exact' })
        .eq('funding_intent_id', row.id)
        .eq('operation_type', 'deposit')
        .order('created_at', { ascending: false })
        .order('attempt_no', { ascending: false })
        .order('id', { ascending: false })
        .limit(64),
      this.client
        .from('funding_operations')
        .select('*')
        .eq('funding_intent_id', row.id)
        .eq('operation_type', 'deposit')
        .not('status', 'in', '(failed,confirmed)')
        .order('created_at', { ascending: false })
        .order('attempt_no', { ascending: false })
        .order('id', { ascending: false })
        .limit(8),
      this.client
        .from('funding_operations')
        .select('*', { count: 'exact' })
        .eq('funding_intent_id', row.id)
        .neq('operation_type', 'deposit')
        .order('created_at', { ascending: false })
        .order('attempt_no', { ascending: false })
        .order('operation_type', { ascending: false })
        .order('id', { ascending: false })
        .limit(64),
      this.client
        .from('funding_operations')
        .select('*')
        .eq('funding_intent_id', row.id)
        .neq('operation_type', 'deposit')
        .not('status', 'in', '(failed,confirmed)')
        .order('created_at', { ascending: false })
        .order('attempt_no', { ascending: false })
        .order('operation_type', { ascending: false })
        .order('id', { ascending: false })
        .limit(8),
    ]);
    if (deposits.error !== null) this.unwrapResult(deposits as DatabaseResult<unknown>);
    if (activeDeposits.error !== null) this.unwrapResult(activeDeposits as DatabaseResult<unknown>);
    if (recovery.error !== null) this.unwrapResult(recovery as DatabaseResult<unknown>);
    if (activeRecovery.error !== null) this.unwrapResult(activeRecovery as DatabaseResult<unknown>);
    const depositMap = new Map<string, SourceDepositOperationRow>();
    for (const operation of [
      ...((activeDeposits.data ?? []) as SourceDepositOperationRow[]),
      ...((deposits.data ?? []) as SourceDepositOperationRow[]),
    ]) {
      if (operation.id !== undefined) depositMap.set(operation.id, operation);
    }
    const recoveryMap = new Map<string, SourceDepositOperationRow>();
    for (const operation of [
      ...((activeRecovery.data ?? []) as SourceDepositOperationRow[]),
      ...((recovery.data ?? []) as SourceDepositOperationRow[]),
    ]) {
      if (operation.id !== undefined && (recoveryMap.has(operation.id) || recoveryMap.size < 64)) {
        recoveryMap.set(operation.id, operation);
      }
    }
    const visibleOperations = [...depositMap.values(), ...recoveryMap.values()];
    const visibleOperationIds = visibleOperations.flatMap((operation) =>
      operation.id === undefined ? [] : [operation.id],
    );
    if (visibleOperationIds.length > 0) {
      const checks = await this.client
        .from('funding_operation_recovery_checks')
        .select('*')
        .in('funding_operation_id', visibleOperationIds)
        .order('checked_at', { ascending: true })
        .order('transaction_hash', { ascending: true })
        .limit(4_356);
      if (checks.error !== null) this.unwrapResult(checks as DatabaseResult<unknown>);
      const byOperation = new Map<string, FundingOperationRecoveryCheckRow[]>();
      for (const check of (checks.data ?? []) as FundingOperationRecoveryCheckRow[]) {
        const values = byOperation.get(check.funding_operation_id) ?? [];
        values.push(check);
        byOperation.set(check.funding_operation_id, values);
      }
      for (const operation of visibleOperations) {
        operation.funding_operation_recovery_checks =
          operation.id === undefined ? [] : (byOperation.get(operation.id) ?? []);
      }
    }
    return {
      ...row,
      funding_operations: visibleOperations,
      source_deposits_total: deposits.count ?? deposits.data?.length ?? 0,
      recovery_attempts_total: recovery.count ?? recovery.data?.length ?? 0,
    };
  }

  public toFundingIntent(row: FundingIntentRow): FundingIntent {
    return mapFundingIntent(row);
  }

  public async listActiveUnifiedBalanceIntentIds(): Promise<readonly string[]> {
    const rows = await this.executeAtomicRpc<readonly { intent_id: string }[]>(
      'list_active_unified_balance_gateway_intent_ids',
      {},
    );
    if (
      !Array.isArray(rows) ||
      rows.some(
        (row) =>
          typeof row !== 'object' ||
          row === null ||
          typeof (row as { intent_id?: unknown }).intent_id !== 'string',
      )
    ) {
      throw new Error('gateway_subscription_active_intents_invalid');
    }
    return rows.map((row) => row.intent_id);
  }

  public async prepareRegistration(input: {
    intentId: string;
    subscriptionId: string;
    leaseId: string;
    leaseExpiresAt: string;
  }): Promise<PreparedGatewaySubscriptionRegistration> {
    const prepared = await this.executeAtomicRpc<unknown>(
      'prepare_gateway_subscription_registration_atomic',
      {
        target_intent_id: input.intentId,
        target_subscription_id: input.subscriptionId,
        requested_lease_id: input.leaseId,
        requested_lease_expires_at: input.leaseExpiresAt,
      },
    );
    if (typeof prepared !== 'object' || prepared === null || Array.isArray(prepared)) {
      throw new Error('gateway_subscription_prepare_result_invalid');
    }
    const value = prepared as Record<string, unknown>;
    const revision =
      typeof value['revision'] === 'number'
        ? value['revision']
        : typeof value['revision'] === 'string'
          ? Number(value['revision'])
          : Number.NaN;
    if (
      typeof value['claimed'] !== 'boolean' ||
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !Array.isArray(value['addresses']) ||
      value['addresses'].some((address) => typeof address !== 'string') ||
      !Array.isArray(value['domains']) ||
      value['domains'].some((domain) => typeof domain !== 'number' || !Number.isInteger(domain))
    ) {
      throw new Error('gateway_subscription_prepare_result_invalid');
    }
    return {
      claimed: value['claimed'],
      revision,
      addresses: value['addresses'] as string[],
      domains: value['domains'] as number[],
    };
  }

  public isIntentReady(intentId: string, subscriptionId: string): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('gateway_subscription_intent_ready', {
      intent_id: intentId,
      subscription_id: subscriptionId,
    });
  }

  public async completeSync(input: {
    subscriptionId: string;
    leaseId: string;
    expectedRevision: number;
    remoteAddresses: readonly string[];
    remoteDomains: readonly number[];
  }): Promise<void> {
    const completed = await this.executeAtomicRpc<boolean>(
      'complete_gateway_subscription_sync_atomic',
      {
        subscription_id: input.subscriptionId,
        lease_id: input.leaseId,
        synced_revision: input.expectedRevision,
        remote_addresses: input.remoteAddresses,
        remote_domains: input.remoteDomains,
      },
    );
    if (!completed) throw new Error('gateway_subscription_sync_lease_lost');
  }

  public async failSync(input: {
    subscriptionId: string;
    leaseId: string;
    errorCode: string;
    retryable: boolean;
  }): Promise<void> {
    const failed = await this.executeAtomicRpc<boolean>('fail_gateway_subscription_sync_atomic', {
      subscription_id: input.subscriptionId,
      lease_id: input.leaseId,
      error_code: input.errorCode,
      retryable: input.retryable,
    });
    if (!failed) throw new Error('gateway_subscription_sync_lease_lost');
  }

  public async recordSignedTest(input: {
    subscriptionId: string;
    notificationId: string;
    receivedAt: string;
  }): Promise<void> {
    await this.executeAtomicRpc<boolean>('record_gateway_webhook_test_atomic', {
      subscription_id: input.subscriptionId,
      notification_id: input.notificationId,
      received_at: input.receivedAt,
    });
  }

  public hasSignedTestAfter(subscriptionId: string, startedAt: string): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('gateway_webhook_test_received_after', {
      subscription_id: subscriptionId,
      received_after: startedAt,
    });
  }

  public async findLatestFundingConfirmation(
    programId: string,
  ): Promise<FundingConfirmationArtifactRow | null> {
    const result = await this.client
      .from('funding_confirmation_artifacts')
      .select('*')
      .eq('program_id', programId)
      .order('reconciled_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as FundingConfirmationArtifactRow | null;
  }

  public toFundingConfirmationArtifact(
    row: FundingConfirmationArtifactRow,
  ): FundingConfirmationArtifact {
    return mapFundingConfirmationArtifact(row);
  }

  public async refreshFundingQuote(input: {
    actorId: string;
    programId: string;
    intentId: string;
    feeReserveBaseUnits: bigint;
    feeAllocations: FundingFeeAllocationRow[];
    quotedAt: string;
    expiresAt: string;
  }): Promise<void> {
    await this.executeAtomicRpc('refresh_funding_quote_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      refreshed_fee_reserve_base_units: input.feeReserveBaseUnits.toString(),
      refreshed_fee_allocations: input.feeAllocations,
      refreshed_quoted_at: input.quotedAt,
      refreshed_expires_at: input.expiresAt,
    });
  }

  public async prepareFundingDestination(input: {
    actorId: string;
    programId: string;
    intentId: string;
    quoteQuotedAt: string;
    feeAllocations: FundingFeeAllocationRow[];
  }): Promise<void> {
    await this.executeAtomicRpc('prepare_funding_destination_checked_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      expected_quote_quoted_at: input.quoteQuotedAt,
      expected_fee_allocations: input.feeAllocations,
    });
  }

  public reopenFundingSourceCollection(input: {
    actorId: string;
    programId: string;
    intentId: string;
    quoteQuotedAt: string;
    feeAllocations: FundingFeeAllocationRow[];
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('reopen_funding_source_collection_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      expected_quote_quoted_at: input.quoteQuotedAt,
      expected_fee_allocations: input.feeAllocations,
    });
  }

  public claimFundingDestinationAttempt(input: {
    actorId: string;
    programId: string;
    intentId: string;
    idempotencyKey: string;
  }): Promise<string> {
    return this.executeAtomicRpc<string>('claim_funding_destination_attempt_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      request_idempotency_key: input.idempotencyKey,
    });
  }

  public armFundingDestinationAttempt(input: {
    actorId: string;
    programId: string;
    intentId: string;
    claimToken: string;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('arm_funding_destination_attempt_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      claim_token: input.claimToken,
    });
  }

  public armBridgeDeliveryRetry(input: {
    actorId: string;
    programId: string;
    intentId: string;
    operationId: string;
    claimToken: string;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('arm_bridge_delivery_retry_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      target_operation_id: input.operationId,
      claim_token: input.claimToken,
    });
  }

  public cancelFundingIntent(input: {
    actorId: string;
    programId: string;
    intentId: string;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('cancel_funding_intent_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
    });
  }

  public releaseRejectedSendAttempt(input: {
    actorId: string;
    programId: string;
    intentId: string;
    operationId: string;
    claimToken: string;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('release_rejected_send_attempt_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      target_operation_id: input.operationId,
      claim_token: input.claimToken,
    });
  }

  public attachFundingDestination(input: {
    actorId: string;
    programId: string;
    intentId: string;
    operationId: string;
    transactionHash: string;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('attach_funding_destination_hash_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      target_operation_id: input.operationId,
      attached_transaction_hash: input.transactionHash.toLowerCase(),
    });
  }

  public attachFundingRecoveryTelemetry(input: {
    actorId: string;
    programId: string;
    intentId: string;
    telemetry: AttachFundingRecoveryTelemetryRequest;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('attach_funding_recovery_telemetry_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      target_operation_id: input.telemetry.operationRecordId,
      observed_provider_state: input.telemetry.providerState,
      observed_retryable: input.telemetry.retryable,
      observed_source_hashes: input.telemetry.sourceTransactionHashes,
      observed_unbound_hashes: input.telemetry.unboundTransactionHashes,
      observed_steps: input.telemetry.steps,
    });
  }

  public createFundingDestinationReplacement(input: {
    actorId: string;
    programId: string;
    intentId: string;
  }): Promise<string> {
    return this.executeAtomicRpc<string>('create_funding_destination_replacement_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
    });
  }

  public async createSourceDeposit(input: {
    actorId: string;
    programId: string;
    intentId: string;
    network: FundingNetworkId;
    chainId: number;
    tokenAddress: string;
    gatewayWalletAddress: string;
    walletAddress: string;
    amountBaseUnits: bigint;
    preGatewayBalanceBaseUnits: bigint;
  }): Promise<string> {
    return this.executeAtomicRpc<string>('create_source_deposit_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      source_network: input.network,
      locked_chain_id: input.chainId,
      locked_token_address: input.tokenAddress.toLowerCase(),
      locked_gateway_wallet_address: input.gatewayWalletAddress.toLowerCase(),
      locked_wallet_address: input.walletAddress.toLowerCase(),
      locked_amount_base_units: input.amountBaseUnits.toString(),
      gateway_pre_balance_base_units: input.preGatewayBalanceBaseUnits.toString(),
    });
  }

  public async findSourceDeposit(depositId: string): Promise<SourceDepositOperationRow | null> {
    const result = await this.client
      .from('funding_operations')
      .select('*')
      .eq('id', depositId)
      .eq('operation_type', 'deposit')
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as SourceDepositOperationRow | null;
  }

  public async findFundingOperation(
    intentId: string,
    operationId: string,
  ): Promise<SourceDepositOperationRow | null> {
    const result = await this.client
      .from('funding_operations')
      .select('*')
      .eq('id', operationId)
      .eq('funding_intent_id', intentId)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as SourceDepositOperationRow | null;
  }

  public async observeSourceDeposit(input: {
    actorId: string;
    programId: string;
    intentId: string;
    depositId: string;
    observation: ObserveSourceDepositRequest;
  }): Promise<void> {
    await this.executeAtomicRpc('observe_claimed_source_deposit_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      target_deposit_id: input.depositId,
      claim_token: input.observation.claimToken,
      observed_outcome: input.observation.outcome,
      observed_transaction_hash: input.observation.transactionHash?.toLowerCase() ?? null,
      observed_failure_code: null,
    });
  }

  public async attachSourceDeposit(input: {
    actorId: string;
    programId: string;
    intentId: string;
    depositId: string;
    transactionHash: string;
  }): Promise<void> {
    await this.executeAtomicRpc('attach_source_deposit_hash_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      target_deposit_id: input.depositId,
      attached_transaction_hash: input.transactionHash.toLowerCase(),
    });
  }

  public armSourceDeposit(input: {
    actorId: string;
    programId: string;
    intentId: string;
    depositId: string;
    claimToken: string;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('arm_source_deposit_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      target_deposit_id: input.depositId,
      claim_token: input.claimToken,
    });
  }

  public async recordSourceDepositOnchain(input: {
    depositId: string;
    transactionHash: string;
    gatewayLogIndex: number;
    transferLogIndex: number;
    blockNumber: bigint;
    blockHash: string;
  }): Promise<void> {
    await this.executeAtomicRpc('record_source_deposit_onchain_verified_atomic', {
      target_deposit_id: input.depositId,
      verified_transaction_hash: input.transactionHash.toLowerCase(),
      verified_gateway_log_index: input.gatewayLogIndex,
      verified_transfer_log_index: input.transferLogIndex,
      verified_block_number: input.blockNumber.toString(),
      verified_block_hash: input.blockHash.toLowerCase(),
    });
  }

  public confirmSourceDeposit(input: {
    depositId: string;
    transactionHash: string;
    logIndex: number;
    blockNumber: bigint;
    blockHash: string;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('confirm_source_deposit_atomic', {
      target_deposit_id: input.depositId,
      verified_transaction_hash: input.transactionHash.toLowerCase(),
      verified_log_index: input.logIndex,
      verified_block_number: input.blockNumber.toString(),
      verified_block_hash: input.blockHash.toLowerCase(),
    });
  }

  public failSourceDepositReverted(depositId: string, transactionHash: string): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('fail_source_deposit_reverted_atomic', {
      target_deposit_id: depositId,
      verified_transaction_hash: transactionHash.toLowerCase(),
    });
  }

  public ingestGatewayDepositFinalized(input: {
    notificationId: string;
    eventId: string;
    subscriptionId: string;
    domain: number;
    walletAddress: string;
    tokenAddress: string;
    amountBaseUnits: bigint;
    fromAddress: string;
    toAddress: string;
    transactionHash: string;
    timestamp: string;
    version: number;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('ingest_circle_gateway_deposit_finalized_atomic', {
      notification_id: input.notificationId,
      event_id: input.eventId,
      subscription_id: input.subscriptionId,
      source_domain: input.domain,
      wallet_address: input.walletAddress.toLowerCase(),
      token_address: input.tokenAddress.toLowerCase(),
      amount_base_units: input.amountBaseUnits.toString(),
      from_address: input.fromAddress.toLowerCase(),
      to_address: input.toAddress.toLowerCase(),
      transaction_hash: input.transactionHash.toLowerCase(),
      event_timestamp: input.timestamp,
      payload_version: input.version,
    });
  }

  public async observeFundingOperation(
    actorId: string,
    programId: string,
    intentId: string,
    input: ObserveFundingOperationRequest,
  ): Promise<void> {
    await this.executeAtomicRpc('observe_claimed_funding_destination_atomic', {
      actor_id: actorId,
      target_program_id: programId,
      target_intent_id: intentId,
      target_operation_id: input.operationRecordId,
      claim_token: input.claimToken,
      observed_outcome: input.outcome,
      observed_provider_operation_id: input.operationId ?? null,
      observed_destination_hash: input.destinationTransactionHash?.toLowerCase() ?? null,
      observed_transfer_id: input.transferId ?? null,
      observed_source_hashes: input.sourceTransactionHashes ?? [],
      observed_provider_state: input.providerState ?? 'pending',
      observed_retryable: input.retryable ?? false,
      observed_steps: input.steps ?? [],
    });
  }

  public recordFundingRecoveryPoll(input: {
    actorId: string;
    programId: string;
    intentId: string;
    operationId: string;
    transactionHash: string;
    state: 'pending' | 'success' | 'reverted';
    blockNumber?: bigint;
    blockHash?: string;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('record_funding_recovery_poll_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_intent_id: input.intentId,
      target_operation_id: input.operationId,
      checked_transaction_hash: input.transactionHash.toLowerCase(),
      checked_state: input.state,
      checked_block_number: input.blockNumber?.toString() ?? null,
      checked_block_hash: input.blockHash?.toLowerCase() ?? null,
    });
  }

  public claimFundingReconciliation(
    intentId: string,
    leaseId: string,
    leaseExpiresAt: string,
  ): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('claim_funding_reconciliation_atomic', {
      target_intent_id: intentId,
      requested_lease_id: leaseId,
      requested_lease_expires_at: leaseExpiresAt,
    });
  }

  public async markFundingSyncing(intentId: string, leaseId: string): Promise<boolean> {
    const result = await this.client
      .from('funding_intents')
      .update({ status: 'syncing_pool', failure_code: null })
      .eq('id', intentId)
      .eq('reconcile_lease_id', leaseId)
      .eq('status', 'verifying_destination')
      .select('id')
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data !== null;
  }

  public async storeFundingSyncTransaction(
    intentId: string,
    transactionId: string,
    leaseId: string,
  ): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('store_funding_sync_transaction_atomic', {
      target_intent_id: intentId,
      requested_lease_id: leaseId,
      circle_transaction_id: transactionId,
    });
  }

  public async markFundingSyncFailed(
    intentId: string,
    transactionId: string,
    failureCode: string,
    leaseId: string,
  ): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('fail_funding_sync_atomic', {
      target_intent_id: intentId,
      requested_lease_id: leaseId,
      verified_circle_transaction_id: transactionId,
      verified_failure_code: failureCode,
    });
  }

  public failFundingDestinationReverted(
    intentId: string,
    transactionHash: string,
  ): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('fail_funding_destination_reverted_atomic', {
      target_intent_id: intentId,
      verified_transaction_hash: transactionHash.toLowerCase(),
    });
  }

  public async reconcileFunding(input: {
    intentId: string;
    leaseId: string;
    destinationHash: string;
    destinationLogIndex: number;
    destinationBlockNumber: bigint;
    destinationBlockHash: string;
    syncHash: string;
    syncLogIndex: number | null;
    verifiedNetBaseUnits: bigint;
    verifiedPostTotalFundedBaseUnits: bigint;
    syncBlockNumber: bigint;
    syncBlockHash: string;
  }): Promise<void> {
    await this.executeAtomicRpc('reconcile_funding_intent_atomic', {
      target_intent_id: input.intentId,
      requested_lease_id: input.leaseId,
      destination_hash: input.destinationHash.toLowerCase(),
      destination_log_index: input.destinationLogIndex,
      destination_block_number: input.destinationBlockNumber.toString(),
      destination_block_hash: input.destinationBlockHash.toLowerCase(),
      sync_hash: input.syncHash.toLowerCase(),
      sync_log_index: input.syncLogIndex,
      verified_net_base_units: input.verifiedNetBaseUnits.toString(),
      verified_post_total_funded_base_units: input.verifiedPostTotalFundedBaseUnits.toString(),
      sync_block_number: input.syncBlockNumber.toString(),
      sync_block_hash: input.syncBlockHash.toLowerCase(),
    });
  }

  public async createWithdrawalIntent(input: {
    actorId: string;
    programId: string;
    idempotencyKey: string;
    walletAddress: string;
    amountBaseUnits: bigint;
    preTotalWithdrawnBaseUnits: bigint;
    escrowAlreadyClosed: boolean;
  }): Promise<WithdrawalIntentRow> {
    const intentId = await this.executeAtomicRpc<string>('create_withdrawal_intent_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      request_idempotency_key: input.idempotencyKey,
      source_wallet: input.walletAddress.toLowerCase(),
      expected_amount_base_units: input.amountBaseUnits.toString(),
      escrow_pre_total_withdrawn_base_units: input.preTotalWithdrawnBaseUnits.toString(),
      escrow_already_closed: input.escrowAlreadyClosed,
    });
    const row = await this.findWithdrawalIntentRow(input.programId, intentId);
    if (row === null) throw new Error('withdrawal_intent_not_found_after_create');
    return row;
  }

  public async createWithdrawalReplacement(input: {
    actorId: string;
    programId: string;
    failedIntentId: string;
    idempotencyKey: string;
    walletAddress: string;
    amountBaseUnits: bigint;
    preTotalWithdrawnBaseUnits: bigint;
    escrowAlreadyClosed: boolean;
  }): Promise<WithdrawalIntentRow> {
    const intentId = await this.executeAtomicRpc<string>(
      'create_withdrawal_replacement_intent_atomic',
      {
        actor_id: input.actorId,
        target_program_id: input.programId,
        target_failed_intent_id: input.failedIntentId,
        request_idempotency_key: input.idempotencyKey,
        source_wallet: input.walletAddress.toLowerCase(),
        expected_amount_base_units: input.amountBaseUnits.toString(),
        escrow_pre_total_withdrawn_base_units: input.preTotalWithdrawnBaseUnits.toString(),
        escrow_already_closed: input.escrowAlreadyClosed,
      },
    );
    const row = await this.findWithdrawalIntentRow(input.programId, intentId);
    if (row === null) throw new Error('withdrawal_replacement_not_found_after_create');
    return row;
  }

  public reconcileLateFunding(input: {
    actorId: string;
    programId: string;
    escrowId: string;
    scannedThroughBlock: bigint;
    advanceCursor: boolean;
    events: readonly {
      transactionHash: string;
      logIndex: number;
      fromAddress: string;
      amountBaseUnits: bigint;
      blockNumber: bigint;
      blockHash: string;
    }[];
  }): Promise<string> {
    return this.executeAtomicRpc<string>('reconcile_late_funding_atomic', {
      actor_id: input.actorId,
      target_program_id: input.programId,
      target_escrow_id: input.escrowId,
      scanned_through_block: input.scannedThroughBlock.toString(),
      advance_cursor: input.advanceCursor,
      verified_events: input.events.map((event) => ({
        transactionHash: event.transactionHash.toLowerCase(),
        logIndex: event.logIndex,
        fromAddress: event.fromAddress.toLowerCase(),
        amountBaseUnits: event.amountBaseUnits.toString(),
        blockNumber: event.blockNumber.toString(),
        blockHash: event.blockHash.toLowerCase(),
      })),
    });
  }

  public async findActiveWithdrawalIntent(programId: string): Promise<WithdrawalIntentRow | null> {
    const result = await this.client
      .from('withdrawal_intents')
      .select('*,escrow_contracts(contract_address)')
      .eq('program_id', programId)
      .in('status', [
        'ready_to_close',
        'ready_to_withdraw',
        'close_submission_uncertain',
        'withdraw_submission_uncertain',
        'close_submitted',
        'withdraw_submitted',
        'verifying',
      ])
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as WithdrawalIntentRow | null;
  }

  public async findWithdrawalIntentRow(
    programId: string,
    intentId: string,
  ): Promise<WithdrawalIntentRow | null> {
    const result = await this.client
      .from('withdrawal_intents')
      .select('*,escrow_contracts(contract_address)')
      .eq('program_id', programId)
      .eq('id', intentId)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as WithdrawalIntentRow | null;
  }

  public toWithdrawalIntent(row: WithdrawalIntentRow): WithdrawalIntent {
    return mapWithdrawalIntent(row);
  }

  public async observeWithdrawalOperation(
    intentId: string,
    input: ObserveWithdrawalRequest,
  ): Promise<void> {
    await this.executeAtomicRpc('observe_withdrawal_operation_atomic', {
      target_intent_id: intentId,
      observed_operation: input.operation,
      observed_transaction_hash: input.transactionHash?.toLowerCase() ?? null,
      observed_outcome: input.outcome ?? 'submitted',
    });
  }

  public confirmWithdrawalClose(
    intentId: string,
    input: { transactionHash: string; logIndex: number; blockNumber: bigint; blockHash: string },
  ): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('confirm_withdrawal_close_atomic', {
      target_intent_id: intentId,
      verified_close_hash: input.transactionHash.toLowerCase(),
      verified_close_log_index: input.logIndex,
      verified_close_block_number: input.blockNumber.toString(),
      verified_close_block_hash: input.blockHash.toLowerCase(),
    });
  }

  public failWithdrawalIntent(
    intentId: string,
    transactionHash: string,
    failureCode: string,
  ): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('fail_withdrawal_intent_atomic', {
      target_intent_id: intentId,
      expected_transaction_hash: transactionHash.toLowerCase(),
      terminal_failure_code: failureCode,
    });
  }

  public reconcileWithdrawal(input: {
    intentId: string;
    transactionHash: string;
    eventLogIndex: number;
    transferLogIndex: number;
    amountBaseUnits: bigint;
    blockNumber: bigint;
    blockHash: string;
  }): Promise<boolean> {
    return this.executeAtomicRpc<boolean>('reconcile_withdrawal_intent_atomic', {
      target_intent_id: input.intentId,
      verified_withdraw_hash: input.transactionHash.toLowerCase(),
      verified_withdraw_log_index: input.eventLogIndex,
      verified_transfer_log_index: input.transferLogIndex,
      verified_amount_base_units: input.amountBaseUnits.toString(),
      verified_block_number: input.blockNumber.toString(),
      verified_block_hash: input.blockHash.toLowerCase(),
    });
  }

  public async findRewardSettlementContext(
    reportId: string,
  ): Promise<RewardSettlementContextRow | null> {
    const result = await this.client
      .from('reports')
      .select('id,program_id,content_hash')
      .eq('id', reportId)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as RewardSettlementContextRow | null;
  }

  public async createRewardSettlementIntent(input: {
    actorId: string;
    reportId: string;
    amount?: string;
    calculationBasisAmount?: string;
    reportKey: string;
    contentHash: string;
    ownerWallet: string;
    idempotencyKey: string;
  }): Promise<RewardSettlementIntentRow> {
    const id = await this.executeAtomicRpc<string>('create_reward_settlement_intent_atomic', {
      actor_id: input.actorId,
      target_report_id: input.reportId,
      reward_amount: input.amount ?? null,
      calculation_basis_amount: input.calculationBasisAmount ?? null,
      target_report_key: input.reportKey.toLowerCase(),
      target_content_hash: input.contentHash.toLowerCase(),
      target_owner_wallet: input.ownerWallet.toLowerCase(),
      request_idempotency_key: input.idempotencyKey,
    });
    const row = await this.findRewardSettlementIntentById(id);
    if (row === null) throw new Error('reward_settlement_not_found_after_create');
    return row;
  }

  public async findRewardSettlementIntentByReport(
    reportId: string,
  ): Promise<RewardSettlementIntentRow | null> {
    const result = await this.client
      .from('reward_settlement_intents')
      .select(
        '*,escrow_contracts(contract_address,deployment_block_number),reward_settlement_operations(*)',
      )
      .eq('report_id', reportId)
      .neq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as RewardSettlementIntentRow | null;
  }

  public async findRewardSettlementIntentById(
    intentId: string,
  ): Promise<RewardSettlementIntentRow | null> {
    const result = await this.client
      .from('reward_settlement_intents')
      .select(
        '*,escrow_contracts(contract_address,deployment_block_number),reward_settlement_operations(*)',
      )
      .eq('id', intentId)
      .maybeSingle();
    if (result.error !== null) this.unwrapResult(result as DatabaseResult<unknown>);
    return result.data as RewardSettlementIntentRow | null;
  }

  public toRewardSettlementIntent(row: RewardSettlementIntentRow): RewardSettlementIntent {
    return mapRewardSettlementIntent(row);
  }

  public async observeRewardApproval(input: {
    actorId: string;
    intentId: string;
    outcome: 'submitted' | 'submission_uncertain';
    transactionHash?: string;
  }): Promise<void> {
    await this.executeAtomicRpc('observe_reward_approval_submission_atomic', {
      actor_id: input.actorId,
      target_intent_id: input.intentId,
      submission_outcome: input.outcome,
      submitted_transaction_hash: input.transactionHash?.toLowerCase() ?? null,
    });
  }

  public async confirmRewardApproval(input: {
    intentId: string;
    transactionHash: string;
    eventLogIndex: number;
    blockNumber: bigint;
    blockHash: string;
  }): Promise<void> {
    await this.executeAtomicRpc('confirm_reward_approval_atomic', {
      target_intent_id: input.intentId,
      submitted_transaction_hash: input.transactionHash.toLowerCase(),
      reward_event_log_index: input.eventLogIndex,
      settled_block_number: input.blockNumber.toString(),
      settled_block_hash: input.blockHash.toLowerCase(),
    });
  }

  public async prepareRewardPayoutRelay(intentId: string, idempotencyKey: string): Promise<void> {
    await this.executeAtomicRpc('prepare_reward_payout_relay_atomic', {
      target_intent_id: intentId,
      target_provider_idempotency_key: idempotencyKey,
    });
  }

  public async acceptRewardPayoutRelay(
    intentId: string,
    idempotencyKey: string,
    circleTransactionId: string,
  ): Promise<void> {
    await this.executeAtomicRpc('accept_reward_payout_relay_atomic', {
      target_intent_id: intentId,
      target_provider_idempotency_key: idempotencyKey,
      target_circle_transaction_id: circleTransactionId,
    });
  }

  public async attachRewardPayoutHash(
    intentId: string,
    circleTransactionId: string,
    transactionHash: string,
  ): Promise<void> {
    await this.executeAtomicRpc('attach_reward_payout_hash_atomic', {
      target_intent_id: intentId,
      target_circle_transaction_id: circleTransactionId,
      submitted_transaction_hash: transactionHash.toLowerCase(),
    });
  }

  public async observeExternalRewardPayout(
    intentId: string,
    transactionHash: string,
  ): Promise<void> {
    await this.executeAtomicRpc('observe_external_reward_payout_atomic', {
      target_intent_id: intentId,
      submitted_transaction_hash: transactionHash.toLowerCase(),
    });
  }

  public async confirmRewardPayout(input: {
    intentId: string;
    transactionHash: string;
    eventLogIndex: number;
    transferLogIndex: number;
    blockNumber: bigint;
    blockHash: string;
    accounting: {
      totalPaidBaseUnits: bigint;
      totalApprovedOutstandingBaseUnits: bigint;
      totalFundedBaseUnits: bigint;
      totalWithdrawnBaseUnits: bigint;
      escrowBalanceBaseUnits: bigint;
    };
  }): Promise<void> {
    await this.executeAtomicRpc('confirm_reward_payout_with_accounting_atomic', {
      target_intent_id: input.intentId,
      submitted_transaction_hash: input.transactionHash.toLowerCase(),
      reward_event_log_index: input.eventLogIndex,
      usdc_transfer_log_index: input.transferLogIndex,
      settled_block_number: input.blockNumber.toString(),
      settled_block_hash: input.blockHash.toLowerCase(),
      post_total_paid_base_units: input.accounting.totalPaidBaseUnits.toString(),
      post_total_approved_outstanding_base_units:
        input.accounting.totalApprovedOutstandingBaseUnits.toString(),
      post_total_funded_base_units: input.accounting.totalFundedBaseUnits.toString(),
      post_total_withdrawn_base_units: input.accounting.totalWithdrawnBaseUnits.toString(),
      post_escrow_balance_base_units: input.accounting.escrowBalanceBaseUnits.toString(),
    });
  }

  public async failRewardSettlementOperation(
    intentId: string,
    operationType: 'approval' | 'payout',
    failureCode: string,
  ): Promise<void> {
    await this.executeAtomicRpc('fail_reward_settlement_operation_atomic', {
      target_intent_id: intentId,
      target_operation_type: operationType,
      target_failure_code: failureCode,
    });
  }

  public async cancelRewardSettlementIntent(actorId: string, intentId: string): Promise<void> {
    await this.executeAtomicRpc('cancel_reward_settlement_intent_atomic', {
      actor_id: actorId,
      target_intent_id: intentId,
    });
  }
}
