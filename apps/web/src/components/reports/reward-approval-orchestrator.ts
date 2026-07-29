import {
  parseUsdcBaseUnits,
  type ObserveRewardApprovalRequest,
  type RewardSettlementIntent,
} from '@bug-bounty-escrow/shared';

import type { connectCircleWallet } from '@/components/owner/circle-funding-executor';

import {
  assertRewardApprovalRecoveryStoreWritable,
  clearRewardApprovalHash,
  clearRewardApprovalUncertain,
  persistRewardApprovalHash,
  persistRewardApprovalUncertain,
  readRewardApprovalHash,
  readRewardApprovalUncertain,
  rewardApprovalFailureOutcome,
  type RewardApprovalRecoveryStore,
} from './review-transitions';

type RewardWalletSession = Awaited<ReturnType<typeof connectCircleWallet>>;

export interface RewardApprovalOrchestratorDependencies {
  readonly cancel: (intentId: string) => Promise<unknown>;
  readonly connect: () => Promise<RewardWalletSession>;
  readonly current: () => Promise<RewardSettlementIntent>;
  readonly observe: (
    intentId: string,
    input: ObserveRewardApprovalRequest,
  ) => Promise<RewardSettlementIntent>;
  readonly reconcile: (intentId: string) => Promise<RewardSettlementIntent>;
  readonly recoveryStore: RewardApprovalRecoveryStore;
  readonly setRecoveryIntent: (intentId: string | undefined) => void;
  readonly setVolatileRecovery: (
    recovery: { intentId: string; transactionHash: string } | undefined,
  ) => void;
}

export async function executeReservedRewardApproval(
  intentId: string,
  dependencies: RewardApprovalOrchestratorDependencies,
  existingSession?: RewardWalletSession,
): Promise<RewardSettlementIntent> {
  const intent = await dependencies.current();
  if (
    intent.id !== intentId ||
    intent.status !== 'awaiting_approval' ||
    intent.operations.some(
      (operation) =>
        operation.operationType === 'approval' &&
        ['submission_uncertain', 'submitted', 'confirmed'].includes(operation.status),
    )
  ) {
    throw new Error('reward_approval_recovery_required');
  }
  if (
    readRewardApprovalHash(dependencies.recoveryStore, intent.id) !== undefined ||
    readRewardApprovalUncertain(dependencies.recoveryStore, intent.id)
  ) {
    dependencies.setRecoveryIntent(intent.id);
    throw new Error('reward_approval_recovery_required');
  }

  // This happens before prepareRewardApproval/eth_sendTransaction. A browser that cannot retain
  // recovery evidence is not allowed to open the transaction prompt.
  assertRewardApprovalRecoveryStoreWritable(dependencies.recoveryStore, intent.id);
  const session = existingSession ?? (await dependencies.connect());
  if (intent.ownerWallet.toLowerCase() !== session.address.toLowerCase()) {
    throw new Error('escrow_owner_wallet_mismatch');
  }
  const amountBaseUnits = parseUsdcBaseUnits(intent.amount);
  if (amountBaseUnits === undefined) throw new Error('reward_amount_invalid');

  try {
    await session.executor.prepareRewardApproval(
      session.wallet.provider,
      session.address,
      intent.escrowAddress,
      intent.reportKey as `0x${string}`,
      intent.approvedContentHash as `0x${string}`,
      intent.recipientAddress as `0x${string}`,
      amountBaseUnits,
    );
  } catch (error) {
    await dependencies.cancel(intent.id);
    throw error;
  }

  let transactionHash: string;
  try {
    transactionHash = await session.executor.approveReward(
      session.wallet.provider,
      session.address,
      intent.escrowAddress,
      intent.reportKey as `0x${string}`,
      intent.approvedContentHash as `0x${string}`,
      intent.recipientAddress as `0x${string}`,
      amountBaseUnits,
    );
  } catch (error) {
    if (rewardApprovalFailureOutcome(error) === 'cancel') {
      await dependencies.cancel(intent.id);
    } else {
      try {
        persistRewardApprovalUncertain(dependencies.recoveryStore, intent.id);
      } catch {
        // Storage passed the preflight but may have become unavailable. The same-page marker still
        // prevents another signature and the server observation is attempted independently.
      }
      dependencies.setRecoveryIntent(intent.id);
      try {
        await dependencies.observe(intent.id, { outcome: 'submission_uncertain' });
        clearRewardApprovalUncertain(dependencies.recoveryStore, intent.id);
      } catch {
        // Keep the local marker so reload persists uncertainty before any further action.
      }
    }
    throw error;
  }

  dependencies.setVolatileRecovery({ intentId: intent.id, transactionHash });
  dependencies.setRecoveryIntent(intent.id);
  try {
    persistRewardApprovalHash(dependencies.recoveryStore, intent.id, transactionHash);
  } catch {
    // POST the known hash even if storage failed after preflight; the volatile copy remains in the
    // current page if the request also fails.
  }
  const observed = await dependencies.observe(intent.id, {
    outcome: 'submitted',
    transactionHash,
  });
  clearRewardApprovalHash(dependencies.recoveryStore, intent.id);
  clearRewardApprovalUncertain(dependencies.recoveryStore, intent.id);
  dependencies.setVolatileRecovery(undefined);
  dependencies.setRecoveryIntent(undefined);
  return observed;
}

export async function resumeRewardApproval(
  dependencies: RewardApprovalOrchestratorDependencies,
  input: {
    recoveryHash?: string;
    volatileRecovery?: { intentId: string; transactionHash: string };
  } = {},
): Promise<RewardSettlementIntent> {
  const current = await dependencies.current();
  const recoveredHash =
    input.recoveryHash ??
    (input.volatileRecovery?.intentId === current.id
      ? input.volatileRecovery.transactionHash
      : undefined) ??
    readRewardApprovalHash(dependencies.recoveryStore, current.id);

  if (recoveredHash !== undefined && current.status === 'awaiting_approval') {
    const sameAttempt = current.operations
      .filter((operation) => operation.operationType === 'approval')
      .find(
        (operation) => operation.transactionHash?.toLowerCase() === recoveredHash.toLowerCase(),
      );
    if (sameAttempt?.status === 'failed') {
      clearRewardApprovalHash(dependencies.recoveryStore, current.id);
      clearRewardApprovalUncertain(dependencies.recoveryStore, current.id);
      dependencies.setRecoveryIntent(undefined);
      dependencies.setVolatileRecovery(undefined);
      return current;
    }
    const observed = await dependencies.observe(current.id, {
      outcome: 'submitted',
      transactionHash: recoveredHash,
    });
    clearRewardApprovalHash(dependencies.recoveryStore, current.id);
    clearRewardApprovalUncertain(dependencies.recoveryStore, current.id);
    dependencies.setRecoveryIntent(undefined);
    dependencies.setVolatileRecovery(undefined);
    return observed;
  }

  if (recoveredHash !== undefined && current.status === 'approval_submitted') {
    const knownHash = current.operations
      .filter((operation) => operation.operationType === 'approval')
      .at(-1)?.transactionHash;
    if (knownHash !== undefined && knownHash.toLowerCase() !== recoveredHash.toLowerCase()) {
      throw new Error('reward_approval_hash_mismatch');
    }
    if (knownHash !== undefined) {
      clearRewardApprovalHash(dependencies.recoveryStore, current.id);
      clearRewardApprovalUncertain(dependencies.recoveryStore, current.id);
      dependencies.setRecoveryIntent(undefined);
      dependencies.setVolatileRecovery(undefined);
    }
  }

  if (
    readRewardApprovalUncertain(dependencies.recoveryStore, current.id) &&
    current.status === 'awaiting_approval' &&
    current.operations.length === 0
  ) {
    await dependencies.observe(current.id, { outcome: 'submission_uncertain' });
    clearRewardApprovalUncertain(dependencies.recoveryStore, current.id);
    dependencies.setRecoveryIntent(undefined);
  }
  return dependencies.reconcile(current.id);
}
