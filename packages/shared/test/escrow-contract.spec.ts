import { describe, expect, it } from 'vitest';

import {
  createFundingIntentRequestSchema,
  deriveFundingRouteMode,
  fundingIntentSchema,
  observeFundingOperationRequestSchema,
  parseUsdcBaseUnits,
} from '../src/index.js';

const REQUEST = {
  idempotencyKey: '31000000-0000-4000-8000-000000000001',
  walletAddress: `0x${'a'.repeat(40)}`,
  grossAmount: '10',
  estimatedFeeReserve: '0.25',
  feeAllocations: [{ network: 'Arc_Testnet', amount: '0.25' }],
  quoteQuotedAt: '2026-07-29T00:00:00.000Z',
  quoteExpiresAt: '2026-07-29T00:10:00.000Z',
  sources: [{ network: 'Arc_Testnet', amount: '10' }],
} as const;

describe('CP-13 escrow contracts', () => {
  it('converts exact six-decimal USDC values and rejects excess precision or uint256 overflow', () => {
    expect(parseUsdcBaseUnits('1.000001')).toBe(1_000_001n);
    expect(parseUsdcBaseUnits('0')).toBe(0n);
    expect(parseUsdcBaseUnits('1.0000001')).toBeUndefined();
    expect(parseUsdcBaseUnits(`${1n << 256n}`)).toBeUndefined();
  });

  it('derives send, bridge, and unified balance from the immutable source selection', () => {
    expect(deriveFundingRouteMode([{ network: 'Arc_Testnet' }])).toBe('send');
    expect(deriveFundingRouteMode([{ network: 'Base_Sepolia' }])).toBe('bridge');
    expect(
      deriveFundingRouteMode([{ network: 'Arc_Testnet' }, { network: 'Base_Sepolia' }]),
    ).toBe('unified_balance');
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
        feeAllocations: [{ network: 'Arc_Testnet', amount: '10.000001' }],
      }).success,
    ).toBe(true);
  });

  it('accepts partial durable recovery telemetry but rejects an empty observation', () => {
    expect(
      observeFundingOperationRequestSchema.safeParse({
        operationId: 'gateway-operation-1',
        providerState: 'pending',
      }).success,
    ).toBe(true);
    expect(observeFundingOperationRequestSchema.safeParse({}).success).toBe(false);
  });

  it('enforces route and status evidence invariants on funding intent responses', () => {
    const base = {
      id: '31000000-0000-4000-8000-000000000001',
      programId: '31000000-0000-4000-8000-000000000002',
      walletAddress: `0x${'a'.repeat(40)}`,
      routeMode: 'send',
      grossAmount: '10',
      estimatedFeeReserve: '0.25',
      feeAllocations: [{ network: 'Arc_Testnet', amount: '0.25' }],
      sources: [{ network: 'Arc_Testnet', amount: '10' }],
      sourceDeposits: [],
      destinationChain: 'Arc_Testnet',
      recipientAddress: `0x${'b'.repeat(40)}`,
      recipientVerified: true,
      status: 'ready_to_sign',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    } as const;
    expect(fundingIntentSchema.safeParse(base).success).toBe(true);
    expect(
      fundingIntentSchema.safeParse({ ...base, routeMode: 'bridge' }).success,
    ).toBe(false);
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
    expect(
      fundingIntentSchema.safeParse({ ...base, status: 'complete' }).success,
    ).toBe(false);
    expect(
      fundingIntentSchema.safeParse({
        ...base,
        routeMode: 'bridge',
        sources: [{ network: 'Base_Sepolia', amount: '10' }],
        feeAllocations: [{ network: 'Base_Sepolia', amount: '0.25' }],
        status: 'source_submitted',
        recovery: {
          attemptNo: 1,
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
        feeAllocations: [{ network: 'Base_Sepolia', amount: '0.25' }],
        status: 'delivery_pending',
      }).success,
    ).toBe(false);
    expect(
      fundingIntentSchema.safeParse({
        ...base,
        routeMode: 'bridge',
        sources: [{ network: 'Base_Sepolia', amount: '10' }],
        feeAllocations: [{ network: 'Base_Sepolia', amount: '0.25' }],
        status: 'delivery_pending',
        destinationTransactionHash: `0x${'2'.repeat(64)}`,
      }).success,
    ).toBe(true);
  });
});
