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
    maskedAddress: z.string().regex(/^0x[a-f0-9]{4}…[a-f0-9]{4}$/).optional(),
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
