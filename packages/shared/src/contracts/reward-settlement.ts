import { z } from 'zod';

import {
  evmAddressSchema,
  isoDateTimeSchema,
  monetaryAmountSchema,
  transactionHashSchema,
  uuidSchema,
} from '../schemas/primitives.js';
import { uuidV4Schema } from './escrow.js';

const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .transform((value) => value.toLowerCase());

export const rewardSettlementStatusSchema = z.enum([
  'awaiting_approval',
  'approval_submitted',
  'ready_for_payout',
  'payout_submitted',
  'paid',
  'failed',
]);

export const rewardSettlementOperationSchema = z
  .object({
    id: uuidSchema,
    operationType: z.enum(['approval', 'payout']),
    attemptNo: z.number().int().positive(),
    status: z.enum([
      'submission_uncertain',
      'provider_accepted',
      'submitted',
      'confirmed',
      'failed',
    ]),
    circleTransactionId: z.string().min(1).max(255).optional(),
    transactionHash: transactionHashSchema.optional(),
    eventLogIndex: z.number().int().nonnegative().optional(),
    transferLogIndex: z.number().int().nonnegative().optional(),
    blockNumber: z.string().regex(/^\d+$/).optional(),
    blockHash: transactionHashSchema.optional(),
    failureCode: z
      .string()
      .regex(/^[a-z][a-z0-9._-]{0,127}$/)
      .optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const rewardSettlementIntentSchema = z
  .object({
    id: uuidSchema,
    reportId: uuidSchema,
    programId: uuidSchema,
    escrowAddress: evmAddressSchema,
    ownerWallet: evmAddressSchema,
    reportKey: bytes32Schema,
    approvedContentHash: bytes32Schema,
    recipientAddress: evmAddressSchema,
    calculationType: z.enum(['range', 'flat', 'percentage']),
    calculationBasisAmount: monetaryAmountSchema.optional(),
    percentageBps: z.number().int().positive().max(10_000).optional(),
    maxRewardCap: monetaryAmountSchema.optional(),
    amount: monetaryAmountSchema,
    status: rewardSettlementStatusSchema,
    failureCode: z
      .string()
      .regex(/^[a-z][a-z0-9._-]{0,127}$/)
      .optional(),
    operations: z.array(rewardSettlementOperationSchema),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const isPercentage = value.calculationType === 'percentage';
    for (const [field, present] of [
      ['calculationBasisAmount', value.calculationBasisAmount !== undefined],
      ['percentageBps', value.percentageBps !== undefined],
      ['maxRewardCap', value.maxRewardCap !== undefined],
    ] as const) {
      if (present !== isPercentage) {
        context.addIssue({
          code: 'custom',
          path: [field],
          message: isPercentage
            ? `${field} is required for a percentage reward`
            : `${field} is only valid for a percentage reward`,
        });
      }
    }
  });

export const createRewardSettlementIntentRequestSchema = z
  .object({
    idempotencyKey: uuidV4Schema,
    ownerWallet: evmAddressSchema,
    amount: monetaryAmountSchema.optional(),
    calculationBasisAmount: monetaryAmountSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.amount === undefined && value.calculationBasisAmount === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Enter the reward amount, or the calculation basis for a percentage tier',
      });
    }
    if (value.amount !== undefined && value.calculationBasisAmount !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['calculationBasisAmount'],
        message: 'Send either a concrete reward or a percentage basis, not both',
      });
    }
  });

export const observeRewardApprovalRequestSchema = z
  .object({
    outcome: z.enum(['submitted', 'submission_uncertain']),
    transactionHash: transactionHashSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome === 'submitted' && value.transactionHash === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['transactionHash'],
        message: 'A submitted approval requires its transaction hash',
      });
    }
    if (value.outcome === 'submission_uncertain' && value.transactionHash !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['transactionHash'],
        message: 'An uncertain submission cannot claim a known transaction hash',
      });
    }
  });

export const rewardSettlementIntentResponseSchema = z
  .object({ success: z.literal(true), data: rewardSettlementIntentSchema })
  .strict();

export type RewardSettlementStatus = z.output<typeof rewardSettlementStatusSchema>;
export type RewardSettlementOperation = z.output<typeof rewardSettlementOperationSchema>;
export type RewardSettlementIntent = z.output<typeof rewardSettlementIntentSchema>;
export type CreateRewardSettlementIntentRequest = z.output<
  typeof createRewardSettlementIntentRequestSchema
>;
export type ObserveRewardApprovalRequest = z.output<typeof observeRewardApprovalRequestSchema>;
export type RewardSettlementIntentResponse = z.output<typeof rewardSettlementIntentResponseSchema>;
