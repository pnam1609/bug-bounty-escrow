import {
  payoutWalletResponseSchema,
  researcherRewardListQuerySchema,
  researcherRewardSummarySchema,
  updatePayoutWalletRequestSchema,
} from '../src/index.js';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const BASE_REWARD = {
  reportId: '10000000-0000-4000-8000-000000000001',
  programId: '20000000-0000-4000-8000-000000000001',
  programName: 'Aegis Protocol',
  reportTitle: 'Accounting invariant bypass',
  finalSeverity: 'critical',
  approvedReward: '2500.000000',
  submittedAt: '2026-07-26T09:00:00.000Z',
  rewardApprovedAt: '2026-07-27T10:00:00.000Z',
} as const;

describe('RW-02 researcher reward contract', () => {
  it('parses canonical page, limit and lifecycle status query values', () => {
    expect(
      researcherRewardListQuerySchema.parse({
        page: '2',
        limit: '25',
        status: 'payment_pending',
      }),
    ).toEqual({ page: 2, limit: 25, status: 'payment_pending' });
    expect(
      researcherRewardListQuerySchema.safeParse({
        page: '1',
        limit: '20',
        researcherId: BASE_REWARD.reportId,
      }).success,
    ).toBe(false);
  });

  it('keeps monetary and chain values as strings and accepts a linked payment', () => {
    const reward = researcherRewardSummarySchema.parse({
      ...BASE_REWARD,
      status: 'payment_pending',
      payment: {
        chainId: '5042002',
        tokenAddress: `0x${'a'.repeat(40)}`,
        transactionHash: `0x${'b'.repeat(64)}`,
        status: 'pending',
        confirmations: 0,
      },
    });

    expect(reward.approvedReward).toBe('2500.000000');
    expect(reward.payment?.chainId).toBe('5042002');
  });

  it('requires paidAt exactly when a reward is paid', () => {
    expect(
      researcherRewardSummarySchema.safeParse({
        ...BASE_REWARD,
        status: 'paid',
      }).success,
    ).toBe(false);
    expect(
      researcherRewardSummarySchema.safeParse({
        ...BASE_REWARD,
        status: 'paid',
        paidAt: '2026-07-27T11:00:00.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects private report body fields from the projection', () => {
    expect(
      researcherRewardSummarySchema.safeParse({
        ...BASE_REWARD,
        status: 'reward_approved',
        description: 'private exploit steps',
      }).success,
    ).toBe(false);
  });
});

describe('RW-04 payout wallet contract', () => {
  const ADDRESS = `0x${'a'.repeat(40)}`;

  it('accepts only a strict EVM address and no identity or secret fields', () => {
    expect(updatePayoutWalletRequestSchema.parse({ address: ADDRESS })).toEqual({
      address: ADDRESS,
    });
    expect(updatePayoutWalletRequestSchema.safeParse({ address: '0x1234' }).success).toBe(false);
    expect(
      updatePayoutWalletRequestSchema.safeParse({ address: `0x${'0'.repeat(40)}` }).success,
    ).toBe(false);
    expect(
      updatePayoutWalletRequestSchema.safeParse({
        address: ADDRESS,
        researcherId: BASE_REWARD.reportId,
      }).success,
    ).toBe(false);
    for (const forbiddenField of [
      'privateKey',
      'seedPhrase',
      'signature',
      'connectedWallet',
    ] as const) {
      expect(
        updatePayoutWalletRequestSchema.safeParse({
          address: ADDRESS,
          [forbiddenField]: 'never',
        }).success,
      ).toBe(false);
    }
  });

  it('returns fixed Arc/USDC context with a masked summary and full explicit-copy value', () => {
    const response = payoutWalletResponseSchema.parse({
      success: true,
      data: {
        address: ADDRESS,
        maskedAddress: '0xaaaa…aaaa',
        network: 'Arc',
        token: 'USDC',
        hasActiveRewards: true,
        canUpdate: true,
        changeConfirmationRequired: true,
        updatedAt: '2026-07-27T12:00:00.000Z',
      },
    });

    expect(response.data.address).toBe(ADDRESS);
    expect(response.data.maskedAddress).toBe('0xaaaa…aaaa');
    expect(response.data.network).toBe('Arc');
    expect(response.data.token).toBe('USDC');
  });

  it('remains representable for the generated OpenAPI response contract', () => {
    expect(() =>
      z.toJSONSchema(payoutWalletResponseSchema, {
        target: 'draft-7',
        unrepresentable: 'any',
      }),
    ).not.toThrow();
  });

  it('keeps the wallet unset and non-editable when no reward needs a destination', () => {
    expect(
      payoutWalletResponseSchema.parse({
        success: true,
        data: {
          network: 'Arc',
          token: 'USDC',
          hasActiveRewards: false,
          canUpdate: false,
          changeConfirmationRequired: false,
        },
      }),
    ).toBeDefined();

    expect(
      payoutWalletResponseSchema.safeParse({
        success: true,
        data: {
          network: 'Arc',
          token: 'USDC',
          hasActiveRewards: false,
          canUpdate: true,
          changeConfirmationRequired: false,
        },
      }).success,
    ).toBe(false);
  });
});
