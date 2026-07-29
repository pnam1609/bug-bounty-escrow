import type { WithdrawalIntent } from '@bug-bounty-escrow/shared';

export type WithdrawalOperation = 'close' | 'withdraw';
export type WithdrawalContinuationAction =
  | 'create'
  | 'observe_close'
  | 'sign_close'
  | 'verify_close'
  | 'observe_withdraw'
  | 'sign_withdraw'
  | 'verify_withdraw'
  | 'attach_close'
  | 'attach_withdraw'
  | 'new_round'
  | 'replace'
  | 'support';

const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/;

function storageKey(programId: string, intentId: string, operation: WithdrawalOperation) {
  return `bounty-escrow:withdrawal:${programId}:${intentId}:${operation}`;
}

export function withdrawalContinuationAction(
  intent: WithdrawalIntent | undefined,
  pendingCloseHash: string | undefined,
  pendingWithdrawHash: string | undefined,
): WithdrawalContinuationAction {
  if (intent === undefined) return 'create';
  if (pendingCloseHash !== undefined) return 'observe_close';
  if (pendingWithdrawHash !== undefined) return 'observe_withdraw';
  if (intent.status === 'close_submission_uncertain') return 'attach_close';
  if (intent.status === 'withdraw_submission_uncertain') return 'attach_withdraw';
  if (intent.status === 'ready_to_close') return 'sign_close';
  if (intent.status === 'close_submitted') return 'verify_close';
  if (intent.status === 'ready_to_withdraw') return 'sign_withdraw';
  if (intent.status === 'withdraw_submitted' || intent.status === 'verifying') {
    return 'verify_withdraw';
  }
  if (intent.status === 'complete') return 'new_round';
  if (intent.status === 'failed') return 'replace';
  return 'support';
}

export function assertWithdrawalRecoveryStorage(storage: Storage): void {
  const probe = 'bounty-escrow:withdrawal:probe';
  storage.setItem(probe, '1');
  storage.removeItem(probe);
}

export function persistPendingWithdrawalHash(
  storage: Storage,
  programId: string,
  intentId: string,
  operation: WithdrawalOperation,
  transactionHash: string,
): void {
  if (!TRANSACTION_HASH.test(transactionHash))
    throw new Error('Invalid withdrawal transaction hash.');
  storage.setItem(storageKey(programId, intentId, operation), transactionHash.toLowerCase());
}

export function readPendingWithdrawalHash(
  storage: Storage,
  programId: string,
  intentId: string,
  operation: WithdrawalOperation,
): string | undefined {
  const value = storage.getItem(storageKey(programId, intentId, operation));
  return value !== null && TRANSACTION_HASH.test(value) ? value : undefined;
}

export function clearPendingWithdrawalHash(
  storage: Storage,
  programId: string,
  intentId: string,
  operation: WithdrawalOperation,
): void {
  storage.removeItem(storageKey(programId, intentId, operation));
}

export async function persistAndObserveReturnedWithdrawalHash<T>(input: {
  storage: Storage;
  programId: string;
  intentId: string;
  operation: WithdrawalOperation;
  transactionHash: string;
  observe: (transactionHash: string) => Promise<T>;
  setVolatileHash?: (transactionHash: string | undefined) => void;
}): Promise<T> {
  input.setVolatileHash?.(input.transactionHash);
  try {
    persistPendingWithdrawalHash(
      input.storage,
      input.programId,
      input.intentId,
      input.operation,
      input.transactionHash,
    );
  } catch {
    // The provider already returned a hash. Browser storage is only a recovery
    // aid and must never prevent the server observation from being attempted.
  }
  const observed = await input.observe(input.transactionHash);
  try {
    clearPendingWithdrawalHash(input.storage, input.programId, input.intentId, input.operation);
  } catch {
    // The durable server observation has succeeded.
  }
  input.setVolatileHash?.(undefined);
  return observed;
}
