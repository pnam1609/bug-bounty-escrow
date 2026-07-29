import type { RewardSettlementIntent } from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  executeReservedRewardApproval,
  resumeRewardApproval,
  type RewardApprovalOrchestratorDependencies,
} from '@/components/reports/reward-approval-orchestrator';

const INTENT_ID = '31000000-0000-4000-8000-000000000001';
const REPORT_ID = '31000000-0000-4000-8000-000000000002';
const PROGRAM_ID = '31000000-0000-4000-8000-000000000003';
const OWNER = `0x${'a'.repeat(40)}` as const;
const ESCROW = `0x${'b'.repeat(40)}` as const;
const RECIPIENT = `0x${'c'.repeat(40)}` as const;
const REPORT_KEY = `0x${'1'.repeat(64)}` as const;
const CONTENT_HASH = `0x${'2'.repeat(64)}` as const;
const APPROVAL_HASH = `0x${'3'.repeat(64)}` as const;
const NOW = '2026-07-29T00:00:00.000Z';

function intent(patch: Partial<RewardSettlementIntent> = {}): RewardSettlementIntent {
  return {
    id: INTENT_ID,
    reportId: REPORT_ID,
    programId: PROGRAM_ID,
    escrowAddress: ESCROW,
    ownerWallet: OWNER,
    reportKey: REPORT_KEY,
    approvedContentHash: CONTENT_HASH,
    recipientAddress: RECIPIENT,
    calculationType: 'range',
    amount: '10.000000',
    status: 'awaiting_approval',
    operations: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...patch,
  };
}

function store() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

function harness(input?: {
  approvalError?: unknown;
  current?: () => Promise<RewardSettlementIntent>;
  observe?: RewardApprovalOrchestratorDependencies['observe'];
  recoveryStore?: ReturnType<typeof store>;
}) {
  const approveReward = vi
    .fn()
    .mockImplementation(() =>
      input?.approvalError === undefined
        ? Promise.resolve(APPROVAL_HASH)
        : Promise.reject(input.approvalError),
    );
  const prepareRewardApproval = vi.fn().mockResolvedValue(undefined);
  const connect = vi.fn().mockResolvedValue({
    address: OWNER,
    wallet: { provider: {} },
    executor: { approveReward, prepareRewardApproval },
  });
  const cancel = vi.fn().mockResolvedValue(intent({ status: 'failed' }));
  const observe =
    input?.observe ??
    vi.fn().mockImplementation((_id, observation) =>
      Promise.resolve(
        intent({
          status: observation.outcome === 'submitted' ? 'approval_submitted' : 'awaiting_approval',
        }),
      ),
    );
  const reconcile = vi.fn().mockResolvedValue(intent({ status: 'ready_for_payout' }));
  const recoveryStore = input?.recoveryStore ?? store();
  const dependencies = {
    cancel,
    connect,
    current: input?.current ?? vi.fn().mockResolvedValue(intent()),
    observe,
    reconcile,
    recoveryStore,
    setRecoveryIntent: vi.fn(),
    setVolatileRecovery: vi.fn(),
  } as unknown as RewardApprovalOrchestratorDependencies;
  return {
    approveReward,
    cancel,
    connect,
    dependencies,
    observe,
    prepareRewardApproval,
    reconcile,
    recoveryStore,
  };
}

describe('owner reward approval orchestration', () => {
  it('requests no wallet transaction when the durable intent read fails', async () => {
    const currentError = new Error('network');
    const test = harness({
      current: vi.fn().mockRejectedValue(currentError),
    });

    await expect(executeReservedRewardApproval(INTENT_ID, test.dependencies)).rejects.toBe(
      currentError,
    );
    expect(test.connect).not.toHaveBeenCalled();
    expect(test.prepareRewardApproval).not.toHaveBeenCalled();
    expect(test.approveReward).not.toHaveBeenCalled();
  });

  it('requests no wallet transaction when recovery storage preflight fails', async () => {
    const blocked = store();
    blocked.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    const test = harness({ recoveryStore: blocked });

    await expect(executeReservedRewardApproval(INTENT_ID, test.dependencies)).rejects.toThrow(
      'reward_recovery_storage_unavailable',
    );
    expect(test.connect).not.toHaveBeenCalled();
    expect(test.prepareRewardApproval).not.toHaveBeenCalled();
    expect(test.approveReward).not.toHaveBeenCalled();
  });

  it('cancels a nested wallet rejection instead of stranding it as uncertain', async () => {
    const test = harness({ approvalError: { cause: { code: 4001 } } });

    await expect(executeReservedRewardApproval(INTENT_ID, test.dependencies)).rejects.toEqual({
      cause: { code: 4001 },
    });
    expect(test.cancel).toHaveBeenCalledWith(INTENT_ID);
    expect(test.observe).not.toHaveBeenCalled();
  });

  it('persists only an ambiguous provider outcome as submission_uncertain', async () => {
    const providerError = new Error('provider disconnected');
    const test = harness({ approvalError: providerError });

    await expect(executeReservedRewardApproval(INTENT_ID, test.dependencies)).rejects.toBe(
      providerError,
    );
    expect(test.cancel).not.toHaveBeenCalled();
    expect(test.observe).toHaveBeenCalledWith(INTENT_ID, {
      outcome: 'submission_uncertain',
    });
  });

  it('reloads after an observation response loss by reconciling the persisted hash without signing again', async () => {
    const firstObservation = vi.fn().mockRejectedValue(new Error('response lost after commit'));
    const first = harness({ observe: firstObservation });

    await expect(executeReservedRewardApproval(INTENT_ID, first.dependencies)).rejects.toThrow(
      'response lost after commit',
    );
    expect(first.approveReward).toHaveBeenCalledOnce();

    const submitted = intent({
      status: 'approval_submitted',
      operations: [
        {
          id: '31000000-0000-4000-8000-000000000010',
          operationType: 'approval',
          attemptNo: 1,
          status: 'submitted',
          transactionHash: APPROVAL_HASH,
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    const reload = harness({
      current: vi.fn().mockResolvedValue(submitted),
      recoveryStore: first.recoveryStore,
    });

    await resumeRewardApproval(reload.dependencies);

    expect(reload.observe).not.toHaveBeenCalled();
    expect(reload.reconcile).toHaveBeenCalledWith(INTENT_ID);
    expect(reload.connect).not.toHaveBeenCalled();
    expect(reload.approveReward).not.toHaveBeenCalled();
  });

  it('still posts a returned hash if storage becomes unavailable after preflight', async () => {
    const flaky = store();
    flaky.setItem.mockImplementation((key: string, value: string) => {
      if (key.endsWith(':probe')) {
        flaky.values.set(key, value);
        return;
      }
      throw new Error('storage became unavailable');
    });
    const test = harness({ recoveryStore: flaky });

    await executeReservedRewardApproval(INTENT_ID, test.dependencies);

    expect(test.observe).toHaveBeenCalledWith(INTENT_ID, {
      outcome: 'submitted',
      transactionHash: APPROVAL_HASH,
    });
  });

  it('clears a locally retained deterministically failed hash and permits a fresh attempt later', async () => {
    const recoveryStore = store();
    recoveryStore.values.set(`bbe:reward-approval:${INTENT_ID}`, APPROVAL_HASH);
    const failed = intent({
      operations: [
        {
          id: '31000000-0000-4000-8000-000000000010',
          operationType: 'approval',
          attemptNo: 1,
          status: 'failed',
          transactionHash: APPROVAL_HASH,
          failureCode: 'reward_approval_reverted',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    });
    const recovery = harness({
      current: vi.fn().mockResolvedValue(failed),
      recoveryStore,
    });

    await expect(resumeRewardApproval(recovery.dependencies)).resolves.toBe(failed);
    expect(recovery.observe).not.toHaveBeenCalled();
    expect(recovery.reconcile).not.toHaveBeenCalled();
    expect(recoveryStore.values.has(`bbe:reward-approval:${INTENT_ID}`)).toBe(false);

    const retry = harness({
      current: vi.fn().mockResolvedValue(failed),
      recoveryStore,
    });
    await executeReservedRewardApproval(INTENT_ID, retry.dependencies);
    expect(retry.approveReward).toHaveBeenCalledOnce();
  });
});
