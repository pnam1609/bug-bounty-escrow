import { fundingIntentResponseSchema } from '@bug-bounty-escrow/shared';
import { describe, expect, it, vi } from 'vitest';

import { EscrowRepository, type FundingIntentRow } from '../src/escrow/escrow.repository.js';

const BURN_HASH = `0x${'b'.repeat(64)}` as const;
const MINT_HASH = `0x${'c'.repeat(64)}` as const;
const ZERO_COMPONENTS = [
  {
    network: 'Base_Sepolia',
    type: 'provider' as const,
    token: 'USDC' as const,
    amountBaseUnits: '0',
  },
  { network: 'Base_Sepolia', type: 'gas' as const, token: 'USDC' as const, amountBaseUnits: '0' },
  { network: 'Base_Sepolia', type: 'kit' as const, token: 'USDC' as const, amountBaseUnits: '0' },
  {
    network: 'Base_Sepolia',
    type: 'forwarder' as const,
    token: 'USDC' as const,
    amountBaseUnits: '0',
  },
] as const;

function row(patch: Partial<FundingIntentRow> = {}): FundingIntentRow {
  return {
    id: '31000000-0000-4000-8000-000000000001',
    program_id: '31000000-0000-4000-8000-000000000002',
    escrow_contract_id: '31000000-0000-4000-8000-000000000003',
    wallet_address: `0x${'a'.repeat(40)}`,
    route_mode: 'bridge',
    gross_amount_base_units: '10000000',
    estimated_fee_reserve_base_units: '0',
    fee_allocations: [
      { network: 'Base_Sepolia', amountBaseUnits: '0', components: [...ZERO_COMPONENTS] },
    ],
    sources: [{ network: 'Base_Sepolia', amountBaseUnits: '10000000' }],
    destination_address: `0x${'d'.repeat(40)}`,
    pre_balance_base_units: '0',
    pre_total_funded_base_units: '0',
    funding_phase: 'ready_for_destination',
    status: 'source_submitted',
    destination_transaction_hash: null,
    transfer_id: null,
    net_received_base_units: null,
    failure_code: null,
    expires_at: '2026-07-29T01:00:00.000Z',
    sync_idempotency_key: '31000000-0000-4000-8000-000000000004',
    sync_circle_transaction_id: null,
    created_at: '2026-07-29T00:00:00.000Z',
    updated_at: '2026-07-29T00:01:00.000Z',
    funding_operations: [
      {
        id: '31000000-0000-4000-8000-000000000099',
        operation_type: 'bridge',
        attempt_no: 1,
        status: 'pending',
        provider_state: 'error',
        retryable: true,
        submission_uncertain: false,
        steps: [
          { name: 'Burn', state: 'success', transactionHash: BURN_HASH },
          { name: 'Mint', state: 'error', errorCode: 'failed_offchain' },
        ],
        funding_operation_recovery_checks: [
          {
            funding_operation_id: '31000000-0000-4000-8000-000000000099',
            transaction_hash: MINT_HASH,
            evidence_role: 'destination',
            network: 'Arc_Testnet',
            state: 'pending',
            block_number: null,
            block_hash: null,
            checked_at: '2026-07-29T00:00:02.000Z',
          },
          {
            funding_operation_id: '31000000-0000-4000-8000-000000000099',
            transaction_hash: BURN_HASH,
            evidence_role: 'source',
            network: 'Base_Sepolia',
            state: 'success',
            block_number: '10',
            block_hash: `0x${'d'.repeat(64)}`,
            checked_at: '2026-07-29T00:00:01.000Z',
          },
        ],
        updated_at: '2026-07-29T00:01:00.000Z',
      },
    ],
    ...patch,
  };
}

describe('durable bridge recovery response', () => {
  const repository = new EscrowRepository({} as never);

  it('serializes source_submitted with bounded evidence and no destination hash', () => {
    const response = fundingIntentResponseSchema.parse({
      success: true,
      data: repository.toFundingIntent(row()),
    });

    expect(response.data.status).toBe('source_submitted');
    expect(response.data.destinationTransactionHash).toBeUndefined();
    expect(response.data.recovery).toMatchObject({
      retryable: true,
      submissionUncertain: false,
      sourceTransactionHashes: [BURN_HASH],
    });
    expect(response.data.recovery?.recoveryChecks?.map((check) => check.transactionHash)).toEqual([
      BURN_HASH,
      MINT_HASH,
    ]);
    expect(JSON.stringify(response)).not.toContain('private provider');
  });

  it('promotes an eventual mint hash to a parseable delivery state', () => {
    const response = fundingIntentResponseSchema.parse({
      success: true,
      data: repository.toFundingIntent(
        row({ status: 'delivery_pending', destination_transaction_hash: MINT_HASH }),
      ),
    });
    expect(response.data.destinationTransactionHash).toBe(MINT_HASH);
  });

  it('hydrates the immutable canonical confirmation artifact after reload', () => {
    const response = fundingIntentResponseSchema.parse({
      success: true,
      data: repository.toFundingIntent(
        row({
          status: 'complete',
          destination_transaction_hash: MINT_HASH,
          net_received_base_units: '9000000',
          funding_operations: [],
          funding_confirmation_artifacts: {
            funding_intent_id: '31000000-0000-4000-8000-000000000001',
            program_id: '31000000-0000-4000-8000-000000000002',
            escrow_contract_id: '31000000-0000-4000-8000-000000000003',
            route_mode: 'bridge',
            escrow_address: `0x${'d'.repeat(40)}`,
            artifact_version: '1.1.0',
            artifact_checksum: `0x${'1'.repeat(64)}`,
            token_address: '0x3600000000000000000000000000000000000000',
            token_decimals: 6,
            destination_transaction_hash: MINT_HASH,
            destination_log_index: 7,
            destination_block_number: '42',
            destination_block_hash: `0x${'2'.repeat(64)}`,
            sync_transaction_hash: `0x${'3'.repeat(64)}`,
            sync_log_index: 8,
            sync_block_number: '43',
            sync_block_hash: `0x${'4'.repeat(64)}`,
            gross_amount_base_units: '10000000',
            estimated_fee_reserve_base_units: '0',
            net_received_base_units: '9000000',
            pre_total_funded_base_units: '1000000',
            required_total_funded_base_units: '10000000',
            post_total_funded_base_units: '10000000',
            total_pool: '10.000000',
            reserved_pool: '1.000000',
            paid_pool: '2.000000',
            withdrawn_pool: '3.000000',
            available_pool: '4.000000',
            reconciled_at: '2026-07-29T00:02:00.000Z',
          },
        }),
      ),
    });

    expect(response.data.confirmationArtifact).toMatchObject({
      fundingIntentId: '31000000-0000-4000-8000-000000000001',
      artifactVersion: '1.1.0',
      requiredTotalFundedAmount: '10',
      postTotalFundedAmount: '10',
      accounting: {
        totalPool: '10.000000',
        totalPaid: '2.000000',
        totalWithdrawn: '3.000000',
        approvedOutstanding: '1.000000',
        availablePool: '4.000000',
      },
    });
  });
});

describe('complete funding operation history', () => {
  it('retrieves the 65th operation on page two with deterministic non-overlapping ranges', async () => {
    const rows = Array.from({ length: 65 }, (_, index) => ({
      id: `operation-${String(index + 1).padStart(2, '0')}`,
    }));
    const ranges: [number, number][] = [];
    const orderings: [string, { ascending: boolean }][] = [];
    const from = vi.fn(() => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        neq: vi.fn(() => query),
        order: vi.fn((column: string, options: { ascending: boolean }) => {
          orderings.push([column, options]);
          return query;
        }),
        range: vi.fn(async (start: number, end: number) => {
          ranges.push([start, end]);
          return { data: rows.slice(start, end + 1), count: rows.length, error: null };
        }),
      };
      return query;
    });
    const repository = new EscrowRepository({ from } as never);

    const first = await repository.listFundingOperationHistory({
      intentId: '31000000-0000-4000-8000-000000000001',
      page: 1,
      limit: 64,
      kind: 'all',
    });
    const second = await repository.listFundingOperationHistory({
      intentId: '31000000-0000-4000-8000-000000000001',
      page: 2,
      limit: 64,
      kind: 'all',
    });

    expect(first.rows).toHaveLength(64);
    expect(second.rows).toEqual([{ id: 'operation-65' }]);
    expect(first.total).toBe(65);
    expect(second.total).toBe(65);
    expect(ranges).toEqual([
      [0, 63],
      [64, 127],
    ]);
    expect(orderings.slice(0, 4).map(([column]) => column)).toEqual([
      'created_at',
      'attempt_no',
      'operation_type',
      'id',
    ]);
  });
});
