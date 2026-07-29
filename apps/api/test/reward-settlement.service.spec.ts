import { describe, expect, it, vi } from 'vitest';

import { EscrowProviderError } from '../src/escrow/escrow-gateways.js';
import { RewardSettlementService } from '../src/escrow/reward-settlement.service.js';
import type {
  RewardSettlementIntentRow,
  RewardSettlementOperationRow,
} from '../src/escrow/escrow.repository.js';

const REPORT_ID = '31000000-0000-4000-8000-000000000001';
const PROGRAM_ID = '31000000-0000-4000-8000-000000000002';
const INTENT_ID = '31000000-0000-4000-8000-000000000003';
const OWNER_ID = '31000000-0000-4000-8000-000000000004';
const ESCROW = `0x${'a'.repeat(40)}` as const;
const OWNER = `0x${'b'.repeat(40)}` as const;
const RECIPIENT = `0x${'c'.repeat(40)}` as const;
const REPORT_KEY = `0x${'1'.repeat(64)}` as const;
const CONTENT_HASH = `0x${'2'.repeat(64)}` as const;
const APPROVAL_HASH = `0x${'3'.repeat(64)}` as const;
const PAYOUT_HASH = `0x${'4'.repeat(64)}` as const;
const BLOCK_HASH = `0x${'5'.repeat(64)}` as const;
const CIRCLE_ID = '31000000-0000-4000-8000-000000000005';
const PROVIDER_KEY = '31000000-0000-4000-8000-000000000006';
const NOW = '2026-07-29T00:00:00.000Z';
const ACCOUNTING = {
  totalPaidBaseUnits: 10_000_000n,
  totalApprovedOutstandingBaseUnits: 0n,
  totalFundedBaseUnits: 50_000_000n,
  totalWithdrawnBaseUnits: 0n,
  escrowBalanceBaseUnits: 40_000_000n,
};

function operation(patch: Partial<RewardSettlementOperationRow>): RewardSettlementOperationRow {
  return {
    id: '31000000-0000-4000-8000-000000000010',
    operation_type: 'approval',
    attempt_no: 1,
    status: 'submitted',
    provider_idempotency_key: null,
    circle_transaction_id: null,
    transaction_hash: APPROVAL_HASH,
    event_log_index: null,
    transfer_log_index: null,
    block_number: null,
    block_hash: null,
    failure_code: null,
    created_at: NOW,
    updated_at: NOW,
    ...patch,
  };
}

function row(patch: Partial<RewardSettlementIntentRow> = {}): RewardSettlementIntentRow {
  return {
    id: INTENT_ID,
    report_id: REPORT_ID,
    program_id: PROGRAM_ID,
    escrow_contract_id: '31000000-0000-4000-8000-000000000007',
    owner_wallet: OWNER,
    report_key: REPORT_KEY,
    approved_content_hash: CONTENT_HASH,
    recipient_address: RECIPIENT,
    calculation_type: 'range',
    calculation_basis_base_units: null,
    percentage_bps: null,
    max_reward_cap_base_units: null,
    amount_base_units: '10000000',
    amount: '10.000000',
    status: 'approval_submitted',
    failure_code: null,
    created_at: NOW,
    updated_at: NOW,
    escrow_contracts: { contract_address: ESCROW, deployment_block_number: '40' },
    reward_settlement_operations: [operation({})],
    ...patch,
  };
}

const principal = { userId: OWNER_ID, email: 'owner@example.test', role: 'owner' as const };

function ownerAccess() {
  return {
    findRewardSettlementContext: vi.fn().mockResolvedValue({
      id: REPORT_ID,
      program_id: PROGRAM_ID,
      content_hash: CONTENT_HASH,
    }),
    isProgramOwner: vi.fn().mockResolvedValue(true),
  };
}

describe('reward settlement orchestration', () => {
  it('uses one owner approval then durably relays permissionless payout through Circle', async () => {
    const approvalConfirmed = operation({
      status: 'confirmed',
      event_log_index: 2,
      block_number: '42',
      block_hash: BLOCK_HASH,
    });
    const payoutUncertain = operation({
      id: '31000000-0000-4000-8000-000000000011',
      operation_type: 'payout',
      status: 'submission_uncertain',
      provider_idempotency_key: PROVIDER_KEY,
      transaction_hash: null,
    });
    const payoutAccepted = operation({
      ...payoutUncertain,
      status: 'provider_accepted',
      circle_transaction_id: CIRCLE_ID,
    });
    const payoutSubmitted = operation({
      ...payoutAccepted,
      status: 'submitted',
      transaction_hash: PAYOUT_HASH,
    });
    const states = [
      row(),
      row({ status: 'ready_for_payout', reward_settlement_operations: [approvalConfirmed] }),
      row({
        status: 'ready_for_payout',
        reward_settlement_operations: [approvalConfirmed, payoutUncertain],
      }),
      row({
        status: 'payout_submitted',
        reward_settlement_operations: [approvalConfirmed, payoutAccepted],
      }),
      row({
        status: 'payout_submitted',
        reward_settlement_operations: [approvalConfirmed, payoutSubmitted],
      }),
      row({
        status: 'paid',
        reward_settlement_operations: [
          approvalConfirmed,
          operation({
            ...payoutSubmitted,
            status: 'confirmed',
            event_log_index: 3,
            transfer_log_index: 4,
            block_number: '43',
            block_hash: BLOCK_HASH,
          }),
        ],
      }),
    ];
    const repository = {
      ...ownerAccess(),
      findRewardSettlementIntentById: vi
        .fn()
        .mockImplementation(() => Promise.resolve(states.shift() ?? row({ status: 'paid' }))),
      confirmRewardApproval: vi.fn(),
      prepareRewardPayoutRelay: vi.fn(),
      acceptRewardPayoutRelay: vi.fn(),
      attachRewardPayoutHash: vi.fn(),
      confirmRewardPayout: vi.fn(),
      failRewardSettlementOperation: vi.fn(),
      toRewardSettlementIntent: vi.fn().mockImplementation((value) => value),
    };
    const arc = {
      verifyRewardApproval: vi.fn().mockResolvedValue({
        transactionHash: APPROVAL_HASH,
        eventLogIndex: 2,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
      }),
      findRewardPayout: vi.fn().mockResolvedValue(null),
      verifyRewardPayout: vi.fn().mockResolvedValue({
        transactionHash: PAYOUT_HASH,
        eventLogIndex: 3,
        transferLogIndex: 4,
        accounting: ACCOUNTING,
        blockNumber: 43n,
        blockHash: BLOCK_HASH,
      }),
    };
    const circle = {
      submitRewardPayout: vi.fn().mockResolvedValue({ transactionId: CIRCLE_ID }),
      waitForTransaction: vi
        .fn()
        .mockResolvedValue({ state: 'confirmed', transactionHash: PAYOUT_HASH }),
    };
    const service = new RewardSettlementService(repository as never, circle as never, arc as never);

    await service.reconcile(principal, REPORT_ID, INTENT_ID);

    expect(repository.confirmRewardApproval).toHaveBeenCalledOnce();
    expect(circle.submitRewardPayout).toHaveBeenCalledWith({
      idempotencyKey: PROVIDER_KEY,
      escrowAddress: ESCROW,
      reportKey: REPORT_KEY,
    });
    expect(repository.acceptRewardPayoutRelay).toHaveBeenCalledBefore(circle.waitForTransaction);
    expect(repository.attachRewardPayoutHash).toHaveBeenCalledBefore(
      repository.confirmRewardPayout,
    );
    expect(repository.confirmRewardPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionHash: PAYOUT_HASH,
        eventLogIndex: 3,
        transferLogIndex: 4,
        accounting: ACCOUNTING,
      }),
    );
  });

  it('reconciles an external permissionless payout without asking Circle to replay it', async () => {
    const approvalConfirmed = operation({
      status: 'confirmed',
      event_log_index: 2,
      block_number: '42',
      block_hash: BLOCK_HASH,
    });
    const repository = {
      ...ownerAccess(),
      findRewardSettlementIntentById: vi
        .fn()
        .mockResolvedValueOnce(row())
        .mockResolvedValueOnce(
          row({ status: 'ready_for_payout', reward_settlement_operations: [approvalConfirmed] }),
        )
        .mockResolvedValueOnce(row({ status: 'paid' })),
      confirmRewardApproval: vi.fn(),
      observeExternalRewardPayout: vi.fn(),
      confirmRewardPayout: vi.fn(),
      failRewardSettlementOperation: vi.fn(),
      toRewardSettlementIntent: vi.fn().mockImplementation((value) => value),
    };
    const arc = {
      verifyRewardApproval: vi.fn().mockResolvedValue({
        transactionHash: APPROVAL_HASH,
        eventLogIndex: 2,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
      }),
      findRewardPayout: vi.fn().mockResolvedValue({
        transactionHash: PAYOUT_HASH,
        eventLogIndex: 3,
        transferLogIndex: 4,
        accounting: ACCOUNTING,
        blockNumber: 43n,
        blockHash: BLOCK_HASH,
      }),
    };
    const circle = { submitRewardPayout: vi.fn(), waitForTransaction: vi.fn() };
    const service = new RewardSettlementService(repository as never, circle as never, arc as never);

    await service.reconcile(principal, REPORT_ID, INTENT_ID);

    expect(repository.observeExternalRewardPayout).toHaveBeenCalledWith(INTENT_ID, PAYOUT_HASH);
    expect(repository.confirmRewardPayout).toHaveBeenCalledOnce();
    expect(circle.submitRewardPayout).not.toHaveBeenCalled();
  });

  it('recovers an uncertain owner approval by bounded Arc scan without another signature', async () => {
    const uncertain = operation({
      status: 'submission_uncertain',
      transaction_hash: null,
    });
    const submitted = operation({ status: 'submitted', transaction_hash: APPROVAL_HASH });
    const approvalConfirmed = operation({
      status: 'confirmed',
      event_log_index: 2,
      block_number: '42',
      block_hash: BLOCK_HASH,
    });
    const repository = {
      ...ownerAccess(),
      findRewardSettlementIntentById: vi
        .fn()
        .mockResolvedValueOnce(
          row({
            status: 'awaiting_approval',
            reward_settlement_operations: [uncertain],
          }),
        )
        .mockResolvedValueOnce(
          row({
            status: 'approval_submitted',
            reward_settlement_operations: [submitted],
          }),
        )
        .mockResolvedValueOnce(
          row({
            status: 'ready_for_payout',
            reward_settlement_operations: [approvalConfirmed],
          }),
        )
        .mockResolvedValueOnce(row({ status: 'paid' })),
      observeRewardApproval: vi.fn(),
      confirmRewardApproval: vi.fn(),
      observeExternalRewardPayout: vi.fn(),
      confirmRewardPayout: vi.fn(),
      failRewardSettlementOperation: vi.fn(),
      toRewardSettlementIntent: vi.fn().mockImplementation((value) => value),
    };
    const arc = {
      findRewardApproval: vi.fn().mockResolvedValue({
        transactionHash: APPROVAL_HASH,
        eventLogIndex: 2,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
      }),
      verifyRewardApproval: vi.fn().mockResolvedValue({
        transactionHash: APPROVAL_HASH,
        eventLogIndex: 2,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
      }),
      findRewardPayout: vi.fn().mockResolvedValue({
        transactionHash: PAYOUT_HASH,
        eventLogIndex: 3,
        transferLogIndex: 4,
        accounting: ACCOUNTING,
        blockNumber: 43n,
        blockHash: BLOCK_HASH,
      }),
    };
    const circle = { submitRewardPayout: vi.fn(), waitForTransaction: vi.fn() };

    await new RewardSettlementService(repository as never, circle as never, arc as never).reconcile(
      principal,
      REPORT_ID,
      INTENT_ID,
    );

    expect(arc.findRewardApproval).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 40n, reportKey: REPORT_KEY }),
    );
    expect(repository.observeRewardApproval).toHaveBeenCalledWith({
      actorId: OWNER_ID,
      intentId: INTENT_ID,
      outcome: 'submitted',
      transactionHash: APPROVAL_HASH,
    });
    expect(circle.submitRewardPayout).not.toHaveBeenCalled();
  });

  it('does not relay a payout when the external payout scan is temporarily unavailable', async () => {
    const approvalConfirmed = operation({
      status: 'confirmed',
      event_log_index: 2,
      block_number: '42',
      block_hash: BLOCK_HASH,
    });
    const current = row({
      status: 'ready_for_payout',
      reward_settlement_operations: [approvalConfirmed],
    });
    const repository = {
      ...ownerAccess(),
      findRewardSettlementIntentById: vi.fn().mockResolvedValue(current),
      toRewardSettlementIntent: vi.fn().mockImplementation((value) => value),
    };
    const arc = {
      findRewardPayout: vi
        .fn()
        .mockRejectedValue(new EscrowProviderError('arc_rpc_unavailable', true)),
    };
    const circle = { submitRewardPayout: vi.fn(), waitForTransaction: vi.fn() };

    await expect(
      new RewardSettlementService(repository as never, circle as never, arc as never).reconcile(
        principal,
        REPORT_ID,
        INTENT_ID,
      ),
    ).resolves.toBe(current);
    expect(circle.submitRewardPayout).not.toHaveBeenCalled();
  });

  it('lets exact external payout evidence supersede an in-flight Circle relay', async () => {
    const approvalConfirmed = operation({
      status: 'confirmed',
      event_log_index: 2,
      block_number: '42',
      block_hash: BLOCK_HASH,
    });
    const payoutAccepted = operation({
      id: '31000000-0000-4000-8000-000000000011',
      operation_type: 'payout',
      status: 'provider_accepted',
      provider_idempotency_key: PROVIDER_KEY,
      circle_transaction_id: CIRCLE_ID,
      transaction_hash: null,
    });
    const repository = {
      ...ownerAccess(),
      findRewardSettlementIntentById: vi
        .fn()
        .mockResolvedValueOnce(
          row({
            status: 'payout_submitted',
            reward_settlement_operations: [approvalConfirmed, payoutAccepted],
          }),
        )
        .mockResolvedValueOnce(row({ status: 'paid' })),
      observeExternalRewardPayout: vi.fn(),
      confirmRewardPayout: vi.fn(),
      toRewardSettlementIntent: vi.fn().mockImplementation((value) => value),
    };
    const arc = {
      findRewardPayout: vi.fn().mockResolvedValue({
        transactionHash: PAYOUT_HASH,
        eventLogIndex: 3,
        transferLogIndex: 4,
        accounting: ACCOUNTING,
        blockNumber: 43n,
        blockHash: BLOCK_HASH,
      }),
    };
    const circle = { submitRewardPayout: vi.fn(), waitForTransaction: vi.fn() };

    await new RewardSettlementService(repository as never, circle as never, arc as never).reconcile(
      principal,
      REPORT_ID,
      INTENT_ID,
    );

    expect(repository.observeExternalRewardPayout).toHaveBeenCalledWith(INTENT_ID, PAYOUT_HASH);
    expect(circle.waitForTransaction).not.toHaveBeenCalled();
  });

  it('scans Arc before releasing an unsigned reservation', async () => {
    const current = row({
      status: 'awaiting_approval',
      reward_settlement_operations: [],
    });
    const cancelled = row({ status: 'failed', failure_code: 'cancelled_before_approval' });
    const repository = {
      ...ownerAccess(),
      findRewardSettlementIntentById: vi
        .fn()
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(cancelled),
      findConfirmedEscrow: vi.fn().mockResolvedValue({
        contract_address: ESCROW,
        deployment_block_number: '40',
      }),
      cancelRewardSettlementIntent: vi.fn(),
      toRewardSettlementIntent: vi.fn().mockImplementation((value) => value),
    };
    const arc = { findRewardApproval: vi.fn().mockResolvedValue(null) };
    const service = new RewardSettlementService(repository as never, {} as never, arc as never);

    await service.cancel(principal, REPORT_ID, INTENT_ID);

    expect(arc.findRewardApproval).toHaveBeenCalledBefore(repository.cancelRewardSettlementIntent);
  });

  it('checks report ownership before looking up current or caller-supplied intent ids', async () => {
    const findById = vi.fn();
    const findByReport = vi.fn();
    const repository = {
      findRewardSettlementContext: vi.fn().mockResolvedValue({
        id: REPORT_ID,
        program_id: PROGRAM_ID,
        content_hash: CONTENT_HASH,
      }),
      isProgramOwner: vi.fn().mockResolvedValue(false),
      findRewardSettlementIntentById: findById,
      findRewardSettlementIntentByReport: findByReport,
    };
    const service = new RewardSettlementService(repository as never, {} as never, {} as never);

    await expect(service.current(principal, REPORT_ID)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.reconcile(principal, REPORT_ID, INTENT_ID)).rejects.toMatchObject({
      status: 403,
    });
    await expect(service.cancel(principal, REPORT_ID, INTENT_ID)).rejects.toMatchObject({
      status: 403,
    });
    expect(findByReport).not.toHaveBeenCalled();
    expect(findById).not.toHaveBeenCalled();
  });
});
