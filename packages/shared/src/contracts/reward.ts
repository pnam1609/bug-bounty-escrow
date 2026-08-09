import { SEVERITIES } from '@bug-bounty-escrow/domain';
import { z } from 'zod';

import { paginationMetadataSchema, paginationQuerySchema } from '../schemas/pagination.js';
import {
  evmAddressSchema,
  isoDateTimeSchema,
  monetaryAmountSchema,
  transactionHashSchema,
  uuidSchema,
} from '../schemas/primitives.js';

export const researcherRewardStatusSchema = z.enum(['reward_approved', 'payment_pending', 'paid']);

export const researcherRewardPaymentStatusSchema = z.enum(['pending', 'confirmed', 'failed']);

export const researcherRewardListQuerySchema = paginationQuerySchema
  .extend({
    status: researcherRewardStatusSchema.optional(),
  })
  .strict();

export const researcherRewardPaymentSchema = z
  .object({
    /** Decimal chain identifier; kept as a string so bigint values never cross JS number. */
    chainId: z.string().regex(/^[1-9]\d*$/, 'Invalid chain ID'),
    tokenAddress: evmAddressSchema,
    transactionHash: transactionHashSchema,
    status: researcherRewardPaymentStatusSchema,
    confirmations: z.number().int().nonnegative().optional(),
    confirmedAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const researcherRewardSummarySchema = z
  .object({
    reportId: uuidSchema,
    programId: uuidSchema,
    programName: z.string(),
    reportTitle: z.string(),
    finalSeverity: z.enum(SEVERITIES),
    status: researcherRewardStatusSchema,
    approvedReward: monetaryAmountSchema,
    submittedAt: isoDateTimeSchema,
    rewardApprovedAt: isoDateTimeSchema,
    payment: researcherRewardPaymentSchema.optional(),
    paidAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((reward, context) => {
    if (reward.status === 'paid' && reward.paidAt === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['paidAt'],
        message: 'paidAt is required for a paid reward',
      });
    }
  });

export const researcherRewardListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(researcherRewardSummarySchema),
    metadata: paginationMetadataSchema,
  })
  .strict();

export const payoutWalletNetworkSchema = z.literal('Arc');
export const payoutWalletTokenSchema = z.literal('USDC');
export const payoutWalletAddressSchema = evmAddressSchema
  .refine((address) => !/^0x0{40}$/i.test(address), 'The zero address cannot receive a payout')
  .overwrite((address) => address.toLowerCase());

export const payoutWalletSchema = z
  .object({
    address: payoutWalletAddressSchema.optional(),
    maskedAddress: z
      .string()
      .regex(/^0x[a-f0-9]{4}…[a-f0-9]{4}$/)
      .optional(),
    network: payoutWalletNetworkSchema,
    token: payoutWalletTokenSchema,
    hasActiveRewards: z.boolean(),
    canUpdate: z.boolean(),
    changeConfirmationRequired: z.boolean(),
    updatedAt: isoDateTimeSchema.optional(),
  })
  .strict()
  .superRefine((wallet, context) => {
    const hasStoredWallet = wallet.address !== undefined;
    if (
      hasStoredWallet !== (wallet.maskedAddress !== undefined) ||
      hasStoredWallet !== (wallet.updatedAt !== undefined)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Stored wallet fields must be returned together',
      });
    }

    if (wallet.canUpdate !== wallet.hasActiveRewards) {
      context.addIssue({
        code: 'custom',
        path: ['canUpdate'],
        message: 'A payout wallet can be updated only while a reward is active',
      });
    }

    if (wallet.changeConfirmationRequired !== (hasStoredWallet && wallet.hasActiveRewards)) {
      context.addIssue({
        code: 'custom',
        path: ['changeConfirmationRequired'],
        message: 'Confirmation is required only when replacing an active payout wallet',
      });
    }
  });

export const payoutWalletResponseSchema = z
  .object({
    success: z.literal(true),
    data: payoutWalletSchema,
  })
  .strict();

export const updatePayoutWalletRequestSchema = z
  .object({
    address: payoutWalletAddressSchema,
    confirmActiveRewardChange: z.boolean().optional(),
  })
  .strict();

export const updatePayoutWalletResponseSchema = payoutWalletResponseSchema;

/** Fixed researcher payout destination for the Arc Testnet MVP. */
export const researcherPayoutWalletSchema = z
  .object({
    id: uuidSchema,
    label: z.string().trim().min(1).max(80).optional(),
    address: payoutWalletAddressSchema,
    maskedAddress: z.string().regex(/^0x[a-f0-9]{4}…[a-f0-9]{4}$/),
    walletType: z.literal('evm'),
    network: z.literal('Arc Testnet'),
    chainId: z.literal(5_042_002),
    verificationMethod: z.literal('eip191_personal_sign'),
    verifiedAt: isoDateTimeSchema,
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const researcherPayoutWalletListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(researcherPayoutWalletSchema),
  })
  .strict();

export const researcherPayoutWalletResponseSchema = z
  .object({
    success: z.literal(true),
    data: researcherPayoutWalletSchema,
  })
  .strict();

export const createPayoutWalletChallengeRequestSchema = z
  .object({ address: payoutWalletAddressSchema })
  .strict();

export const payoutWalletChallengePurposeSchema = z.literal(
  'researcher_payout_wallet_verification',
);

export const payoutWalletChallengeSchema = z
  .object({
    id: uuidSchema,
    address: payoutWalletAddressSchema,
    chainId: z.literal(5_042_002),
    message: z.string().min(1).max(2_048),
    issuedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema,
  })
  .strict();

export const payoutWalletChallengeResponseSchema = z
  .object({ success: z.literal(true), data: payoutWalletChallengeSchema })
  .strict();

export const verifyPayoutWalletRequestSchema = z
  .object({
    /** Viem accepts canonical 65-byte and EIP-2098 compact 64-byte signatures. */
    signature: z.string().regex(/^0x(?:[0-9a-fA-F]{128}|[0-9a-fA-F]{130})$/),
    label: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export type ResearcherRewardStatus = z.output<typeof researcherRewardStatusSchema>;
export type ResearcherRewardPaymentStatus = z.output<typeof researcherRewardPaymentStatusSchema>;
export type ResearcherRewardListQuery = z.output<typeof researcherRewardListQuerySchema>;
export type ResearcherRewardPayment = z.output<typeof researcherRewardPaymentSchema>;
export type ResearcherRewardSummary = z.output<typeof researcherRewardSummarySchema>;
export type ResearcherRewardListResponse = z.output<typeof researcherRewardListResponseSchema>;
export type PayoutWallet = z.output<typeof payoutWalletSchema>;
export type PayoutWalletResponse = z.output<typeof payoutWalletResponseSchema>;
export type UpdatePayoutWalletRequest = z.output<typeof updatePayoutWalletRequestSchema>;
export type UpdatePayoutWalletResponse = z.output<typeof updatePayoutWalletResponseSchema>;
export type ResearcherPayoutWallet = z.output<typeof researcherPayoutWalletSchema>;
export type ResearcherPayoutWalletListResponse = z.output<
  typeof researcherPayoutWalletListResponseSchema
>;
export type ResearcherPayoutWalletResponse = z.output<typeof researcherPayoutWalletResponseSchema>;
export type CreatePayoutWalletChallengeRequest = z.output<
  typeof createPayoutWalletChallengeRequestSchema
>;
export type PayoutWalletChallenge = z.output<typeof payoutWalletChallengeSchema>;
export type PayoutWalletChallengeResponse = z.output<typeof payoutWalletChallengeResponseSchema>;
export type VerifyPayoutWalletRequest = z.output<typeof verifyPayoutWalletRequestSchema>;
