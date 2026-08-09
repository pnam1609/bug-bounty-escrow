import {
  createPayoutWalletChallengeRequestSchema,
  payoutWalletChallengeResponseSchema,
  payoutWalletResponseSchema,
  researcherPayoutWalletListResponseSchema,
  researcherRewardListQuerySchema,
  researcherRewardSummarySchema,
  updatePayoutWalletRequestSchema,
  verifyPayoutWalletRequestSchema,
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

describe('verified researcher payout-wallet contract', () => {
  const ADDRESS = `0x${'a'.repeat(40)}`;
  const WALLET_ID = '10000000-0000-4000-8000-000000000011';

  it('accepts only a connected address when requesting a server challenge', () => {
    expect(createPayoutWalletChallengeRequestSchema.parse({ address: ADDRESS })).toEqual({
      address: ADDRESS,
    });
    expect(
      createPayoutWalletChallengeRequestSchema.safeParse({
        address: ADDRESS,
        chainId: 1,
      }).success,
    ).toBe(false);
  });

  it('requires a canonical EIP-191 signature and never accepts secret material', () => {
    expect(
      verifyPayoutWalletRequestSchema.safeParse({ signature: `0x${'a'.repeat(130)}` }).success,
    ).toBe(true);
    expect(
      verifyPayoutWalletRequestSchema.safeParse({ signature: `0x${'a'.repeat(128)}` }).success,
    ).toBe(true);
    expect(verifyPayoutWalletRequestSchema.safeParse({ signature: '0x1234' }).success).toBe(false);
    expect(
      verifyPayoutWalletRequestSchema.safeParse({
        signature: `0x${'a'.repeat(130)}`,
        privateKey: 'never',
      }).success,
    ).toBe(false);
  });

  it('pins the challenge and saved wallet to Arc Testnet', () => {
    const now = '2026-08-10T10:00:00.000Z';
    const challenge = payoutWalletChallengeResponseSchema.parse({
      success: true,
      data: {
        id: WALLET_ID,
        address: ADDRESS,
        chainId: 5_042_002,
        message: 'exact server message',
        issuedAt: now,
        expiresAt: '2026-08-10T10:05:00.000Z',
      },
    });
    expect(challenge.data.chainId).toBe(5_042_002);

    expect(
      researcherPayoutWalletListResponseSchema.parse({
        success: true,
        data: [
          {
            id: WALLET_ID,
            address: ADDRESS,
            maskedAddress: '0xaaaa…aaaa',
            walletType: 'evm',
            network: 'Arc Testnet',
            chainId: 5_042_002,
            verificationMethod: 'eip191_personal_sign',
            verifiedAt: now,
            createdAt: now,
          },
        ],
      }).data,
    ).toHaveLength(1);
  });
});
