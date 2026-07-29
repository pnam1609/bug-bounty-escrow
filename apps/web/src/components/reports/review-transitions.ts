import type { ReportStatus } from '@bug-bounty-escrow/shared';

/*
 * The reviewer decision map, kept out of the component so it stays plain data: it is the thing a
 * test can check against the domain state machine without rendering anything.
 */

export type ActionId =
  | 'approve-reward'
  | 'confirm-payment'
  | 'mark-duplicate'
  | 'pay'
  | 'reject'
  | 'request-information'
  | 'validate';

/**
 * The report status each action moves the report to. The domain owns status -> status; this owns
 * action -> endpoint. Different shapes, so only a cross-check keeps them honest — see
 * `test/review-transitions.spec.ts`.
 */
export const ACTION_RESULT_STATUS: Readonly<Record<ActionId, ReportStatus>> = Object.freeze({
  'request-information': 'needs_information',
  validate: 'validated',
  reject: 'rejected',
  'mark-duplicate': 'duplicate',
  'approve-reward': 'reward_approved',
  pay: 'payment_pending',
  'confirm-payment': 'paid',
});

/** Which decisions the current status permits. `needs_information` waits on the researcher. */
export const ACTIONS_BY_STATUS: Readonly<Record<ReportStatus, readonly ActionId[]>> = Object.freeze(
  {
    draft: [],
    submitted: ['validate', 'request-information', 'reject', 'mark-duplicate'],
    triaged: ['validate', 'request-information', 'reject', 'mark-duplicate'],
    needs_information: [],
    rejected: [],
    duplicate: [],
    validated: ['approve-reward'],
    reward_approved: ['pay'],
    payment_pending: ['confirm-payment'],
    paid: [],
  },
);

export function rewardSettlementUiMode(input: {
  reportStatus: ReportStatus;
  intentState: 'absent' | 'error' | 'loaded' | 'loading';
  localRecoveryKnown?: boolean;
  intent?: {
    status: string;
    operations: readonly { operationType: string; status: string }[];
  };
}): 'approve' | 'continue' | 'error' | 'loading' | 'none' | 'resume' {
  if (!['validated', 'reward_approved', 'payment_pending'].includes(input.reportStatus)) {
    return 'none';
  }
  if (input.intentState === 'loading') return 'loading';
  if (input.intentState === 'error') return 'error';
  if (input.intentState === 'absent') {
    return input.reportStatus === 'validated' ? 'approve' : 'error';
  }
  if (input.intent === undefined) return 'error';
  if (input.intent.status === 'failed') {
    return input.reportStatus === 'validated' ? 'approve' : 'error';
  }
  const durableApproval =
    input.intent?.operations.some(
      (operation) =>
        operation.operationType === 'approval' &&
        ['submission_uncertain', 'submitted', 'confirmed'].includes(operation.status),
    ) ?? false;
  if (
    durableApproval ||
    input.localRecoveryKnown === true ||
    input.intent.status !== 'awaiting_approval'
  ) {
    return 'resume';
  }
  return 'continue';
}

export function rewardApprovalFailureOutcome(error: unknown): 'cancel' | 'uncertain' {
  const visited = new Set<object>();
  let candidate: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof candidate !== 'object' || candidate === null || visited.has(candidate)) {
      return 'uncertain';
    }
    visited.add(candidate);
    const record = candidate as { cause?: unknown; code?: unknown; name?: unknown };
    if (
      record.code === 4001 ||
      record.code === 'ACTION_REJECTED' ||
      record.name === 'UserRejectedRequestError'
    ) {
      return 'cancel';
    }
    candidate = record.cause;
  }
  return 'uncertain';
}

export function rewardApprovalRecoveryKey(intentId: string): string {
  return `bbe:reward-approval:${intentId}`;
}

export function rewardApprovalUncertainKey(intentId: string): string {
  return `bbe:reward-approval-uncertain:${intentId}`;
}

export interface RewardApprovalRecoveryStore {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function persistRewardApprovalHash(
  store: RewardApprovalRecoveryStore,
  intentId: string,
  transactionHash: string,
): void {
  store.setItem(rewardApprovalRecoveryKey(intentId), transactionHash);
}

export function readRewardApprovalHash(
  store: RewardApprovalRecoveryStore,
  intentId: string,
): string | undefined {
  let value: string | null;
  try {
    value = store.getItem(rewardApprovalRecoveryKey(intentId));
  } catch {
    return undefined;
  }
  return value !== null && /^0x[0-9a-fA-F]{64}$/.test(value) ? value : undefined;
}

export function clearRewardApprovalHash(
  store: RewardApprovalRecoveryStore,
  intentId: string,
): void {
  try {
    store.removeItem(rewardApprovalRecoveryKey(intentId));
  } catch {
    // The server evidence remains authoritative; stale browser recovery data is harmless.
  }
}

export function persistRewardApprovalUncertain(
  store: RewardApprovalRecoveryStore,
  intentId: string,
): void {
  store.setItem(rewardApprovalUncertainKey(intentId), '1');
}

export function readRewardApprovalUncertain(
  store: RewardApprovalRecoveryStore,
  intentId: string,
): boolean {
  try {
    return store.getItem(rewardApprovalUncertainKey(intentId)) === '1';
  } catch {
    return false;
  }
}

export function clearRewardApprovalUncertain(
  store: RewardApprovalRecoveryStore,
  intentId: string,
): void {
  try {
    store.removeItem(rewardApprovalUncertainKey(intentId));
  } catch {
    // The server evidence remains authoritative; stale browser recovery data is harmless.
  }
}

export function assertRewardApprovalRecoveryStoreWritable(
  store: RewardApprovalRecoveryStore,
  intentId: string,
): void {
  const key = `${rewardApprovalRecoveryKey(intentId)}:probe`;
  const probe = `0x${'0'.repeat(64)}`;
  try {
    store.setItem(key, probe);
    if (store.getItem(key) !== probe) {
      throw new Error('reward_recovery_storage_unavailable');
    }
    store.removeItem(key);
  } catch {
    try {
      store.removeItem(key);
    } catch {
      // The original failure is the only signal callers need; never inspect storage errors.
    }
    throw new Error('reward_recovery_storage_unavailable');
  }
}
