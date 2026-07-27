import { z } from 'zod';

import { isoDateTimeSchema, monetaryAmountSchema } from '../schemas/primitives.js';

export const researcherReportSummarySchema = z
  .object({
    allReports: z.number().int().nonnegative(),
    needsInformation: z.number().int().nonnegative(),
    underReview: z.number().int().nonnegative(),
    rewardsPaid: monetaryAmountSchema,
    paymentToken: z.literal('USDC'),
    calculatedAt: isoDateTimeSchema,
  })
  .strict();

export const researcherReportSummaryResponseSchema = z
  .object({
    success: z.literal(true),
    data: researcherReportSummarySchema,
  })
  .strict();

export type ResearcherReportSummary = z.infer<typeof researcherReportSummarySchema>;
export type ResearcherReportSummaryResponse = z.infer<typeof researcherReportSummaryResponseSchema>;
