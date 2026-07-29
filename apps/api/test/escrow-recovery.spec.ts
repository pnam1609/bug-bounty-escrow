import { fundingIntentResponseSchema } from '@bug-bounty-escrow/shared';
import { describe, expect, it } from 'vitest';

import {
  EscrowRepository,
  type FundingIntentRow,
} from '../src/escrow/escrow.repository.js';

const BURN_HASH = `0x${'b'.repeat(64)}` as const;
const MINT_HASH = `0x${'c'.repeat(64)}` as const;

function row(patch: Partial<FundingIntentRow> = {}): FundingIntentRow {
  return {
    id: '31000000-0000-4000-8000-000000000001',
    program_id: '31000000-0000-4000-8000-000000000002',
    escrow_contract_id: '31000000-0000-4000-8000-000000000003',
    wallet_address: `0x${'a'.repeat(40)}`,
    route_mode: 'bridge',
    gross_amount_base_units: '10000000',
    estimated_fee_reserve_base_units: '0',
    fee_allocations: [{ network: 'Base_Sepolia', amountBaseUnits: '0' }],
    sources: [{ network: 'Base_Sepolia', amountBaseUnits: '10000000' }],
    destination_address: `0x${'d'.repeat(40)}`,
    pre_balance_base_units: '0',
    pre_total_funded_base_units: '0',
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
        provider_state: 'error',
        retryable: true,
        submission_uncertain: false,
        steps: [
          { name: 'Burn', state: 'success', transactionHash: BURN_HASH },
          { name: 'Mint', state: 'error', errorCode: 'failed_offchain' },
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
