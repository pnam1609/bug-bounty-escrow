import { describe, expect, it } from 'vitest';

import {
  attachFundingRecoveryTelemetryRequestSchema,
  createFundingIntentRequestSchema,
  deriveFundingRouteMode,
  fundingIntentSchema,
  observeFundingOperationRequestSchema,
  parseUsdcBaseUnits,
} from '../src/index.js';

function fee(network: 'Arc_Testnet' | 'Base_Sepolia', amount: string) {
  return {
    network,
    amount,
    components: [
      { network, type: 'provider', token: 'USDC', amount },
      { network, type: 'gas', token: 'USDC', amount: '0' },
      { network, type: 'kit', token: 'USDC', amount: '0' },
      { network, type: 'forwarder', token: 'USDC', amount: '0' },
    ],
  } as const;
}

const REQUEST = {
  idempotencyKey: '31000000-0000-4000-8000-000000000001',
  walletAddress: `0x${'a'.repeat(40)}`,
  grossAmount: '10',
  estimatedFeeReserve: '0.25',
  feeAllocations: [fee('Arc_Testnet', '0.25')],
  quoteQuotedAt: '2026-07-29T00:00:00.000Z',
  quoteExpiresAt: '2026-07-29T00:10:00.000Z',
  sources: [{ network: 'Arc_Testnet', amount: '10' }],
} as const;

describe('CP-13 escrow contracts', () => {
  it('rejects duplicate recovery step identities before the RPC boundary', () => {
    const hash = `0x${'9'.repeat(64)}`;
    const base = {
      operationRecordId: '31000000-0000-4000-8000-000000000099',
      providerState: 'error' as const,
      retryable: true,
      sourceTransactionHashes: [hash],
      unboundTransactionHashes: [],
    };
    expect(
      attachFundingRecoveryTelemetryRequestSchema.safeParse({
        ...base,
        steps: [
          { name: 'burn', state: 'success', network: 'Base_Sepolia', transactionHash: hash },
          { name: 'mint', state: 'error', network: 'Base_Sepolia', transactionHash: hash },
        ],
      }).success,
    ).toBe(false);
    expect(
      attachFundingRecoveryTelemetryRequestSchema.safeParse({
        ...base,
        steps: [{ name: 'burn', state: 'success', network: 'Base_Sepolia', transactionHash: hash }],
      }).success,
    ).toBe(true);
    expect(
      attachFundingRecoveryTelemetryRequestSchema.safeParse({
        ...base,
        sourceTransactionHashes: [],
        steps: [
          { name: 'Mint', state: 'pending' },
          { name: 'mint', state: 'error', errorCode: 'duplicate_name' },
        ],
      }).success,
    ).toBe(false);
  });

  it('converts exact six-decimal USDC values and rejects excess precision or uint256 overflow', () => {
    expect(parseUsdcBaseUnits('1.000001')).toBe(1_000_001n);
    expect(parseUsdcBaseUnits('0')).toBe(0n);
    expect(parseUsdcBaseUnits('1.0000001')).toBeUndefined();
    expect(parseUsdcBaseUnits(`${1n << 256n}`)).toBeUndefined();
  });

  it('derives send, bridge, and unified balance from the immutable source selection', () => {
    expect(deriveFundingRouteMode([{ network: 'Arc_Testnet' }])).toBe('send');
    expect(deriveFundingRouteMode([{ network: 'Base_Sepolia' }])).toBe('bridge');
    expect(deriveFundingRouteMode([{ network: 'Arc_Testnet' }, { network: 'Base_Sepolia' }])).toBe(
      'unified_balance',
    );
  });

  it('requires unique sources whose exact sum equals gross and a bounded fee reserve', () => {
    expect(createFundingIntentRequestSchema.safeParse(REQUEST).success).toBe(true);
    expect(
      createFundingIntentRequestSchema.safeParse({
        ...REQUEST,
        sources: [
          { network: 'Arc_Testnet', amount: '5' },
          { network: 'Arc_Testnet', amount: '5' },
        ],
      }).success,
    ).toBe(false);
    expect(
      createFundingIntentRequestSchema.safeParse({
        ...REQUEST,
        sources: [{ network: 'Arc_Testnet', amount: '9.999999' }],
      }).success,
    ).toBe(false);
    expect(
      createFundingIntentRequestSchema.safeParse({
        ...REQUEST,
        estimatedFeeReserve: '10.000001',
        feeAllocations: [fee('Arc_Testnet', '10.000001')],
      }).success,
    ).toBe(true);
    expect(
      createFundingIntentRequestSchema.safeParse({
        ...REQUEST,
        feeAllocations: [fee('Base_Sepolia', '0.25')],
      }).success,
    ).toBe(false);
    expect(
      createFundingIntentRequestSchema.safeParse({
        ...REQUEST,
        feeAllocations: [
          {
            ...fee('Arc_Testnet', '0.25'),
            components: [
              ...fee('Arc_Testnet', '0.25').components.slice(0, 1),
              { network: 'Arc_Testnet', type: 'gas', token: 'USDC', amount: '0.01' },
              ...fee('Arc_Testnet', '0.25').components.slice(2),
            ],
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires a claimed durable record/token and rejects legacy or empty observations', () => {
    expect(
      observeFundingOperationRequestSchema.safeParse({
        operationId: 'gateway-operation-1',
        providerState: 'pending',
      }).success,
    ).toBe(false);
    expect(
      observeFundingOperationRequestSchema.safeParse({
        operationRecordId: '31000000-0000-4000-8000-000000000099',
        claimToken: '31000000-0000-4000-8000-000000000098',
        outcome: 'provider_progress',
        operationId: 'gateway-operation-1',
        providerState: 'pending',
      }).success,
    ).toBe(true);
    expect(observeFundingOperationRequestSchema.safeParse({}).success).toBe(false);
    const hash = `0x${'1'.repeat(64)}`;
    expect(
      observeFundingOperationRequestSchema.safeParse({
        operationRecordId: '31000000-0000-4000-8000-000000000099',
        outcome: 'submitted',
        destinationTransactionHash: `0x${'2'.repeat(64)}`,
        sourceTransactionHashes: [hash, hash],
        steps: [
          {
            name: 'source_transaction',
            state: 'success',
            network: 'Base_Sepolia',
            transactionHash: hash,
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      observeFundingOperationRequestSchema.safeParse({
        operationRecordId: '31000000-0000-4000-8000-000000000099',
        outcome: 'submitted',
        destinationTransactionHash: hash,
        sourceTransactionHashes: [hash],
      }).success,
    ).toBe(false);
  });

  it('enforces route and status evidence invariants on funding intent responses', () => {
    const base = {
      id: '31000000-0000-4000-8000-000000000001',
      programId: '31000000-0000-4000-8000-000000000002',
      walletAddress: `0x${'a'.repeat(40)}`,
      routeMode: 'send',
      fundingPhase: 'ready_for_destination',
      grossAmount: '10',
      estimatedFeeReserve: '0.25',
      feeAllocations: [fee('Arc_Testnet', '0.25')],
      sources: [{ network: 'Arc_Testnet', amount: '10' }],
      sourceDeposits: [],
      destinationChain: 'Arc_Testnet',
      recipientAddress: `0x${'b'.repeat(40)}`,
      recipientVerified: true,
      status: 'ready_to_sign',
      expiresAt: '2026-07-29T01:00:00.000Z',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    } as const;
    expect(fundingIntentSchema.safeParse(base).success).toBe(true);
    expect(fundingIntentSchema.safeParse({ ...base, routeMode: 'bridge' }).success).toBe(false);
    expect(
      fundingIntentSchema.safeParse({
        ...base,
        fundingPhase: 'collecting_deposits',
      }).success,
    ).toBe(false);
    expect(
      fundingIntentSchema.safeParse({
        ...base,
        routeMode: 'unified_balance',
        fundingPhase: 'collecting_deposits',
        sources: [
          { network: 'Arc_Testnet', amount: '5' },
          { network: 'Base_Sepolia', amount: '5' },
        ],
        feeAllocations: [fee('Arc_Testnet', '0.1'), fee('Base_Sepolia', '0.15')],
      }).success,
    ).toBe(true);
    expect(
      fundingIntentSchema.safeParse({
        ...base,
        grossAmount: '11',
        sources: [
          { network: 'Arc_Testnet', amount: '5' },
          { network: 'Arc_Testnet', amount: '5' },
        ],
        routeMode: 'unified_balance',
      }).success,
    ).toBe(false);
    expect(fundingIntentSchema.safeParse({ ...base, status: 'complete' }).success).toBe(false);
    expect(
      fundingIntentSchema.safeParse({
        ...base,
        routeMode: 'bridge',
        sources: [{ network: 'Base_Sepolia', amount: '10' }],
        feeAllocations: [fee('Base_Sepolia', '0.25')],
        status: 'source_submitted',
        recovery: {
          operationRecordId: '31000000-0000-4000-8000-000000000099',
          operationType: 'bridge',
          attemptNo: 1,
          status: 'pending',
          providerState: 'error',
          retryable: true,
          submissionUncertain: false,
          sourceTransactionHashes: [`0x${'1'.repeat(64)}`],
          steps: [
            {
              name: 'Burn',
              state: 'success',
              transactionHash: `0x${'1'.repeat(64)}`,
            },
            { name: 'Mint', state: 'error', errorCode: 'failed_offchain' },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      fundingIntentSchema.safeParse({
        ...base,
        routeMode: 'bridge',
        sources: [{ network: 'Base_Sepolia', amount: '10' }],
        feeAllocations: [fee('Base_Sepolia', '0.25')],
        status: 'delivery_pending',
      }).success,
    ).toBe(false);
    expect(
      fundingIntentSchema.safeParse({
        ...base,
        routeMode: 'bridge',
        sources: [{ network: 'Base_Sepolia', amount: '10' }],
        feeAllocations: [fee('Base_Sepolia', '0.25')],
        status: 'delivery_pending',
        destinationTransactionHash: `0x${'2'.repeat(64)}`,
      }).success,
    ).toBe(true);
  });
});
