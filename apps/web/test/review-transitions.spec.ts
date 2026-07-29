import { REPORT_STATUS_TRANSITIONS, type ReportStatus } from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  ACTIONS_BY_STATUS,
  ACTION_RESULT_STATUS,
  assertRewardApprovalRecoveryStoreWritable,
  clearRewardApprovalHash,
  clearRewardApprovalUncertain,
  persistRewardApprovalHash,
  persistRewardApprovalUncertain,
  readRewardApprovalHash,
  readRewardApprovalUncertain,
  rewardApprovalFailureOutcome,
  rewardApprovalRecoveryKey,
  rewardSettlementUiMode,
} from '@/components/reports/review-transitions';

/*
 * The reviewer panel keeps its own status -> action map because the domain state machine knows
 * nothing about HTTP endpoints. That copy can drift, and drifting the wrong way means offering a
 * button the server will reject with `invalid_report_transition`. These tests tie the two
 * together so the drift cannot survive a test run.
 */
describe('reviewer action map', () => {
  it('never offers an action the domain state machine forbids', () => {
    for (const [status, actions] of Object.entries(ACTIONS_BY_STATUS)) {
      const allowed = REPORT_STATUS_TRANSITIONS[status as ReportStatus];

      for (const action of actions) {
        expect(
          allowed,
          `status "${status}" offers "${action}" -> "${ACTION_RESULT_STATUS[action]}"`,
        ).toContain(ACTION_RESULT_STATUS[action]);
      }
    }
  });

  it('offers an action for every status the domain can still move out of', () => {
    // `needs_information` is the deliberate exception: the next move belongs to the researcher,
    // who resubmits, not to the reviewer.
    const reviewerWaits: readonly ReportStatus[] = ['draft', 'needs_information'];

    for (const [status, nextStatuses] of Object.entries(REPORT_STATUS_TRANSITIONS)) {
      if (nextStatuses.length === 0 || reviewerWaits.includes(status as ReportStatus)) {
        continue;
      }

      expect(
        ACTIONS_BY_STATUS[status as ReportStatus],
        `status "${status}" can still move but the reviewer is offered nothing`,
      ).not.toHaveLength(0);
    }
  });

  it('covers every report status so a new one cannot be silently unhandled', () => {
    expect(Object.keys(ACTIONS_BY_STATUS).sort()).toEqual(
      Object.keys(REPORT_STATUS_TRANSITIONS).sort(),
    );
  });

  it('never offers another owner signature after an uncertain or known approval survives reload', () => {
    for (const status of ['submission_uncertain', 'submitted', 'confirmed'] as const) {
      expect(
        rewardSettlementUiMode({
          reportStatus: 'validated',
          intentState: 'loaded',
          intent: {
            status: status === 'confirmed' ? 'ready_for_payout' : 'awaiting_approval',
            operations: [{ operationType: 'approval', status }],
          },
        }),
      ).toBe('resume');
    }
    expect(
      rewardSettlementUiMode({
        reportStatus: 'validated',
        intentState: 'loading',
      }),
    ).toBe('loading');
  });

  it('fails closed on an unknown current-intent query error and only approves an explicit absence', () => {
    expect(
      rewardSettlementUiMode({
        reportStatus: 'validated',
        intentState: 'error',
      }),
    ).toBe('error');
    expect(
      rewardSettlementUiMode({
        reportStatus: 'validated',
        intentState: 'absent',
      }),
    ).toBe('approve');
    expect(
      rewardSettlementUiMode({
        reportStatus: 'reward_approved',
        intentState: 'absent',
      }),
    ).toBe('error');
  });

  it('continues a reserved pre-sign intent but never signs again when local recovery is known', () => {
    const intent = {
      status: 'awaiting_approval',
      operations: [],
    };
    expect(
      rewardSettlementUiMode({
        reportStatus: 'validated',
        intentState: 'loaded',
        intent,
      }),
    ).toBe('continue');
    expect(
      rewardSettlementUiMode({
        reportStatus: 'validated',
        intentState: 'loaded',
        localRecoveryKnown: true,
        intent,
      }),
    ).toBe('resume');
  });

  it('cancels only explicit wallet rejection and preserves ambiguous outcomes for recovery', () => {
    expect(rewardApprovalFailureOutcome({ code: 4001 })).toBe('cancel');
    expect(rewardApprovalFailureOutcome({ code: 'ACTION_REJECTED' })).toBe('cancel');
    expect(rewardApprovalFailureOutcome({ cause: { code: 4001 } })).toBe('cancel');
    expect(
      rewardApprovalFailureOutcome({
        cause: { cause: { name: 'UserRejectedRequestError' } },
      }),
    ).toBe('cancel');
    expect(rewardApprovalFailureOutcome(new Error('provider disconnected'))).toBe('uncertain');
    expect(rewardApprovalRecoveryKey('intent-id')).toBe('bbe:reward-approval:intent-id');
  });

  it('recovers a returned approval hash after a page crash without signing again', () => {
    const values = new Map<string, string>();
    const store = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    const hash = `0x${'a'.repeat(64)}`;
    persistRewardApprovalHash(store, 'intent-id', hash);
    expect(readRewardApprovalHash(store, 'intent-id')).toBe(hash);
    clearRewardApprovalHash(store, 'intent-id');
    expect(readRewardApprovalHash(store, 'intent-id')).toBeUndefined();
    persistRewardApprovalUncertain(store, 'intent-id');
    expect(readRewardApprovalUncertain(store, 'intent-id')).toBe(true);
    clearRewardApprovalUncertain(store, 'intent-id');
    expect(readRewardApprovalUncertain(store, 'intent-id')).toBe(false);
  });

  it('fails before a wallet transaction when durable recovery storage is not writable', () => {
    const sendTransaction = vi.fn();
    const blockedStore = {
      getItem: vi.fn(() => null),
      removeItem: vi.fn(),
      setItem: vi.fn(() => {
        throw new Error('quota');
      }),
    };

    expect(() => {
      assertRewardApprovalRecoveryStoreWritable(blockedStore, 'intent-id');
      sendTransaction();
    }).toThrow('reward_recovery_storage_unavailable');
    expect(sendTransaction).not.toHaveBeenCalled();
  });
});
