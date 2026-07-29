import { ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { EscrowProviderError } from '../src/escrow/escrow-gateways.js';
import { EscrowService } from '../src/escrow/escrow.service.js';
import type { FundingIntentRow } from '../src/escrow/escrow.repository.js';

const PROGRAM_ID = '31000000-0000-4000-8000-000000000001';
const INTENT_ID = '31000000-0000-4000-8000-000000000002';
const ESCROW_ID = '31000000-0000-4000-8000-000000000003';
const WALLET = `0x${'a'.repeat(40)}` as const;
const ESCROW = `0x${'b'.repeat(40)}` as const;
const DESTINATION_HASH = `0x${'c'.repeat(64)}` as const;
const SYNC_HASH_1 = `0x${'d'.repeat(64)}` as const;
const SYNC_HASH_2 = `0x${'e'.repeat(64)}` as const;
const ZERO_COMPONENTS = [
  {
    network: 'Arc_Testnet',
    type: 'provider' as const,
    token: 'USDC' as const,
    amountBaseUnits: '0',
  },
  { network: 'Arc_Testnet', type: 'gas' as const, token: 'USDC' as const, amountBaseUnits: '0' },
  { network: 'Arc_Testnet', type: 'kit' as const, token: 'USDC' as const, amountBaseUnits: '0' },
  {
    network: 'Arc_Testnet',
    type: 'forwarder' as const,
    token: 'USDC' as const,
    amountBaseUnits: '0',
  },
] as const;

function fundingRow(): FundingIntentRow {
  return {
    id: INTENT_ID,
    program_id: PROGRAM_ID,
    escrow_contract_id: ESCROW_ID,
    wallet_address: WALLET,
    route_mode: 'send',
    gross_amount_base_units: '10000000',
    estimated_fee_reserve_base_units: '0',
    fee_allocations: [
      { network: 'Arc_Testnet', amountBaseUnits: '0', components: [...ZERO_COMPONENTS] },
    ],
    sources: [{ network: 'Arc_Testnet', amountBaseUnits: '10000000' }],
    destination_address: ESCROW,
    pre_balance_base_units: '0',
    pre_total_funded_base_units: '0',
    funding_phase: 'ready_for_destination',
    status: 'delivery_pending',
    destination_transaction_hash: DESTINATION_HASH,
    transfer_id: null,
    net_received_base_units: null,
    failure_code: null,
    expires_at: '2099-07-29T01:00:00.000Z',
    sync_idempotency_key: '31000000-0000-4000-8000-000000000004',
    sync_circle_transaction_id: null,
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:01:00.000Z',
    funding_operations: [],
  };
}

describe('funding sync terminal recovery', () => {
  it('links fresh sync attempts after Circle failure and proven Arc revert, then credits once', async () => {
    let row = fundingRow();
    const submittedIds = [
      '31000000-0000-4000-8000-000000000011',
      '31000000-0000-4000-8000-000000000012',
      '31000000-0000-4000-8000-000000000013',
    ];
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findFundingIntentRow: vi.fn().mockImplementation(async () => row),
      findConfirmedEscrow: vi.fn().mockResolvedValue({
        id: ESCROW_ID,
        contract_address: ESCROW,
      }),
      claimFundingReconciliation: vi.fn().mockResolvedValue(true),
      markFundingSyncing: vi.fn().mockImplementation(async () => {
        row = { ...row, status: 'syncing_pool' };
        return true;
      }),
      storeFundingSyncTransaction: vi
        .fn()
        .mockImplementation(async (_intentId: string, transactionId: string) => {
          row = { ...row, sync_circle_transaction_id: transactionId };
          return true;
        }),
      markFundingSyncFailed: vi
        .fn()
        .mockImplementation(async (_intentId: string, transactionId: string) => {
          expect(transactionId).toBe(row.sync_circle_transaction_id);
          row = {
            ...row,
            status: 'sync_failed',
            sync_circle_transaction_id: null,
            sync_idempotency_key: submittedIds[repository.markFundingSyncFailed.mock.calls.length]!,
          };
          return true;
        }),
      reconcileFunding: vi.fn().mockImplementation(async () => {
        row = { ...row, status: 'complete', net_received_base_units: '10000000' };
      }),
      toFundingIntent: vi.fn().mockImplementation(() => ({ status: row.status })),
      failFundingDestinationReverted: vi.fn(),
    };
    const circle = {
      submitSyncExternalFunding: vi
        .fn()
        .mockImplementation(async () => ({ transactionId: submittedIds.shift()! })),
      waitForTransaction: vi
        .fn()
        .mockResolvedValueOnce({ state: 'failed', failureCode: 'circle_sync_failed' })
        .mockResolvedValueOnce({ state: 'confirmed', transactionHash: SYNC_HASH_1 })
        .mockResolvedValueOnce({ state: 'confirmed', transactionHash: SYNC_HASH_2 }),
    };
    const arc = {
      verifyFundingDestination: vi.fn().mockResolvedValue({
        destinationTransactionHash: DESTINATION_HASH,
        destinationLogIndex: 7,
        netReceivedBaseUnits: 10_000_000n,
        blockNumber: 10n,
        blockHash: `0x${'1'.repeat(64)}`,
      }),
      verifyFundingSync: vi
        .fn()
        .mockRejectedValueOnce(new EscrowProviderError('funding_sync_reverted', false))
        .mockResolvedValueOnce({
          transactionHash: SYNC_HASH_2,
          logIndex: 8,
          newlyObservedBaseUnits: 10_000_000n,
          totalFundedBaseUnits: 10_000_000n,
          blockNumber: 11n,
          blockHash: `0x${'2'.repeat(64)}`,
        }),
    };
    const service = new EscrowService(
      repository as never,
      circle as never,
      arc as never,
      {
        CIRCLE_POLL_TIMEOUT_MS: 1_000,
        CIRCLE_REQUEST_TIMEOUT_MS: 1_000,
      } as never,
      {} as never,
    );
    const principal = {
      userId: '31000000-0000-4000-8000-000000000099',
      email: 'owner@example.test',
      role: 'owner' as const,
    };

    await expect(service.reconcileFunding(principal, PROGRAM_ID, INTENT_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(service.reconcileFunding(principal, PROGRAM_ID, INTENT_ID)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.reconcileFunding(principal, PROGRAM_ID, INTENT_ID)).resolves.toMatchObject(
      {
        status: 'complete',
      },
    );

    expect(repository.markFundingSyncFailed).toHaveBeenCalledTimes(2);
    expect(repository.storeFundingSyncTransaction).toHaveBeenCalledTimes(3);
    expect(repository.reconcileFunding).toHaveBeenCalledTimes(1);
  });

  it('hydrates the latest confirmation only for the program owner', async () => {
    const artifact = { fundingIntentId: INTENT_ID };
    const repository = {
      isProgramOwner: vi.fn().mockResolvedValue(true),
      findLatestFundingConfirmation: vi.fn().mockResolvedValue({ funding_intent_id: INTENT_ID }),
      toFundingConfirmationArtifact: vi.fn().mockReturnValue(artifact),
    };
    const service = new EscrowService(
      repository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const principal = {
      userId: '31000000-0000-4000-8000-000000000099',
      email: 'owner@example.test',
      role: 'owner' as const,
    };

    await expect(service.getLatestFundingConfirmation(principal, PROGRAM_ID)).resolves.toBe(
      artifact,
    );
    repository.isProgramOwner.mockResolvedValueOnce(false);
    await expect(
      service.getLatestFundingConfirmation(principal, PROGRAM_ID),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
