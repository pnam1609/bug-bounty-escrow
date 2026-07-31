import {
  ASSET_TYPES,
  DISCLOSURE_DECISIONS,
  REPORT_IMPACT_SOURCES,
  REPORT_STATUSES,
  SEVERITIES,
} from '@bug-bounty-escrow/domain';
import { z } from 'zod';

import { MAX_UPLOAD_SIZE_BYTES, SAFE_UPLOAD_MIME_TYPES } from '../constants/uploads.js';
import { paginationQuerySchema } from '../schemas/pagination.js';
import {
  evmAddressSchema,
  httpsUrlSchema,
  isoDateTimeSchema,
  monetaryAmountSchema,
  nonEmptyTrimmedTextSchema,
  transactionHashSchema,
  uuidSchema,
} from '../schemas/primitives.js';

export const reportStatusSchema = z.enum(REPORT_STATUSES);
export const reportSeveritySchema = z.enum(SEVERITIES);
export const reportImpactSourceSchema = z.enum(REPORT_IMPACT_SOURCES);
export const disclosureDecisionSchema = z.enum(DISCLOSURE_DECISIONS);

const MAX_SELECTED_IMPACTS = 20;

export const reportListQuerySchema = paginationQuerySchema
  .extend({
    programId: uuidSchema.optional(),
    researcherId: uuidSchema.optional(),
    status: reportStatusSchema.optional(),
    severity: reportSeveritySchema.optional(),
  })
  .strict();

export const reportIdParamsSchema = z.object({ id: uuidSchema }).strict();
export const reportAttachmentParamsSchema = z
  .object({ id: uuidSchema, attachmentId: uuidSchema })
  .strict();

/**
 * Impact selection is structured, not free text: each entry must resolve to an enabled impact in
 * the program's catalog for the affected scope's asset type. Custom entries are only accepted
 * when the program sets `allowCustomImpact`.
 */
const impactSelectionShape = {
  programImpactIds: z.array(uuidSchema).max(MAX_SELECTED_IMPACTS).default([]),
  customImpacts: z.array(nonEmptyTrimmedTextSchema.max(300)).max(MAX_SELECTED_IMPACTS).default([]),
};

function assertAtLeastOneImpact(
  value: {
    readonly programImpactIds: readonly string[];
    readonly customImpacts: readonly string[];
  },
  context: z.RefinementCtx,
): void {
  if (value.programImpactIds.length + value.customImpacts.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['programImpactIds'],
      message: 'Select at least one impact',
    });
  }
}

export const createReportRequestSchema = z
  .object({
    affectedScopeId: uuidSchema,
    ...impactSelectionShape,
    title: nonEmptyTrimmedTextSchema.max(300),
    description: nonEmptyTrimmedTextSchema.max(50_000),
    /** Required only when the program's PoC policy demands it; validated server-side. */
    reproductionSteps: nonEmptyTrimmedTextSchema.max(50_000).optional(),
    /** Optional pointer to a secret Gist. Never a substitute for a required PoC. */
    secretGistUrl: httpsUrlSchema.optional(),
    proposedSeverity: reportSeveritySchema,
    /**
     * Audit signal recording that the researcher saw their proposed severity differ from the
     * highest severity among the impacts they picked, and chose to continue anyway. It never
     * promotes the proposal into a final severity.
     */
    severityMismatchAcknowledged: z.boolean().default(false),
  })
  .strict()
  .superRefine(assertAtLeastOneImpact);

export const updateReportRequestSchema = z
  .object({
    affectedScopeId: uuidSchema.optional(),
    programImpactIds: z.array(uuidSchema).max(MAX_SELECTED_IMPACTS).optional(),
    customImpacts: z.array(nonEmptyTrimmedTextSchema.max(300)).max(MAX_SELECTED_IMPACTS).optional(),
    title: nonEmptyTrimmedTextSchema.max(300).optional(),
    description: nonEmptyTrimmedTextSchema.max(50_000).optional(),
    reproductionSteps: nonEmptyTrimmedTextSchema.max(50_000).optional(),
    secretGistUrl: httpsUrlSchema.nullable().optional(),
    proposedSeverity: reportSeveritySchema.optional(),
    severityMismatchAcknowledged: z.boolean().optional(),
    /** Sends the report back for review after answering a `needs_information` request. */
    resubmit: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.programImpactIds === undefined && value.customImpacts === undefined) {
      return;
    }

    assertAtLeastOneImpact(
      {
        programImpactIds: value.programImpactIds ?? [],
        customImpacts: value.customImpacts ?? [],
      },
      context,
    );
  });

export const requestInformationRequestSchema = z
  .object({ reason: nonEmptyTrimmedTextSchema.max(2_000) })
  .strict();
export const validateReportRequestSchema = z
  .object({ finalSeverity: reportSeveritySchema })
  .strict();
export const rejectReportRequestSchema = z
  .object({ reason: nonEmptyTrimmedTextSchema.max(2_000) })
  .strict();
export const markDuplicateRequestSchema = z
  .object({ originalReportId: uuidSchema, reason: z.string().trim().max(2_000).optional() })
  .strict();
/**
 * Range and flat tiers take the concrete USDC `amount` the reviewer decided on.
 *
 * Percentage tiers do not: the reviewer supplies the verified `calculationBasisAmount` (the funds
 * actually at risk) and the server derives the reward from the tier's basis points, applies the
 * cap, and snapshots every input alongside the result. `amount` is ignored for those tiers so a
 * miscalculating client cannot decide the payout.
 */
export const approveRewardRequestSchema = z
  .object({
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

    if (value.calculationBasisAmount !== undefined && Number(value.calculationBasisAmount) <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['calculationBasisAmount'],
        message: 'Enter a calculation basis above zero',
      });
    }
  });

export const startPaymentRequestSchema = z
  .object({ transactionHash: transactionHashSchema, tokenAddress: evmAddressSchema })
  .strict();

export const confirmPaymentRequestSchema = z
  .object({
    blockNumber: z.number().int().nonnegative(),
    blockHash: transactionHashSchema,
    confirmations: z.number().int().positive().default(1),
  })
  .strict();

export const disclosureDecisionRequestSchema = z
  .object({
    decision: disclosureDecisionSchema,
    publicTitle: nonEmptyTrimmedTextSchema.max(300).optional(),
    publicSummary: nonEmptyTrimmedTextSchema.max(5_000).optional(),
    publicContent: nonEmptyTrimmedTextSchema.max(50_000).optional(),
    publicSeverity: reportSeveritySchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === 'keep_private') {
      return;
    }

    if (value.publicTitle === undefined || value.publicSummary === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['publicSummary'],
        message: 'Publishing requires a public title and summary',
      });
    }

    if (value.publicSeverity === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['publicSeverity'],
        message: 'Choose the severity to publish',
      });
    }

    if (value.decision === 'publish_full' && value.publicContent === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['publicContent'],
        message: 'A full disclosure requires public content',
      });
    }
  });

export const attachmentUploadRequestSchema = z
  .object({
    /** Supplied when retrying a failed upload so the retry reuses the existing attachment row. */
    attachmentId: uuidSchema.optional(),
    filename: nonEmptyTrimmedTextSchema
      .max(255)
      .refine(
        (value) =>
          !value.includes('/') &&
          !value.includes('\\') &&
          [...value].every((character) => character.charCodeAt(0) >= 32),
        'Filename is not safe',
      ),
    mimeType: z.enum(SAFE_UPLOAD_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(MAX_UPLOAD_SIZE_BYTES),
    checksumSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();

export const signedUploadResponseSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        attachmentId: uuidSchema,
        uploadUrl: z.string().url(),
        expiresAt: isoDateTimeSchema,
      })
      .strict(),
  })
  .strict();

export const signedDownloadResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ downloadUrl: z.string().url(), expiresAt: isoDateTimeSchema }).strict(),
  })
  .strict();

export const commentListQuerySchema = paginationQuerySchema.strict();
export const createCommentRequestSchema = z
  .object({ body: nonEmptyTrimmedTextSchema.max(10_000) })
  .strict();

export const reportAttachmentSchema = z
  .object({
    id: uuidSchema,
    filename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().positive(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const reportCommentSchema = z
  .object({
    id: uuidSchema,
    authorId: uuidSchema,
    body: z.string(),
    deleted: z.boolean(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

const paginationMetadata = z
  .object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    totalItems: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  })
  .strict();

export const commentListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(reportCommentSchema),
    metadata: paginationMetadata,
  })
  .strict();

export const createCommentResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ id: uuidSchema }).strict(),
  })
  .strict();

/** A claimed impact, as snapshotted when the report was submitted. */
export const reportImpactSchema = z
  .object({
    id: uuidSchema,
    source: reportImpactSourceSchema,
    programImpactId: uuidSchema.optional(),
    title: z.string(),
    severity: reportSeveritySchema.optional(),
    assetType: z.enum(ASSET_TYPES),
  })
  .strict();

/** Private report projection of the exact scope selected at submit time. */
export const reportAffectedScopeSchema = z
  .object({
    id: uuidSchema,
    assetType: z.enum(ASSET_TYPES),
    name: z.string(),
    assetUrl: z.string().optional(),
    contractAddress: evmAddressSchema.optional(),
  })
  .strict();

/** Caller-specific actions. The API, rather than the status badge, is the source of truth. */
export const reportCapabilitiesSchema = z
  .object({
    canEdit: z.boolean(),
    canResubmit: z.boolean(),
  })
  .strict();

export const reportInformationRequestSchema = z
  .object({
    message: z.string(),
    requestedAt: isoDateTimeSchema,
  })
  .strict();

/**
 * AI assistance is an advisory sub-state, not a report lifecycle status. The field is optional
 * for compatibility while an API deployment is being upgraded; the UI treats an omitted value
 * as unavailable rather than inventing a result. Fingerprints and duplicate candidates are only
 * present in an owner/reviewer projection after server-side authorization.
 */
export const aiReviewStatusSchema = z.enum(['processing', 'ready', 'unavailable']);
export const aiDuplicateAssessmentSchema = z.enum(['none', 'possible', 'likely']);

export const aiReportFingerprintSchema = z
  .object({
    affectedComponents: z.array(z.string()),
    functions: z.array(z.string()),
    attackVector: z.string(),
    vulnerabilityClasses: z.array(z.string()),
    prerequisites: z.array(z.string()),
    securityImpacts: z.array(z.string()),
    normalizedSummary: z.string(),
  })
  .strict();

export const aiDuplicateCandidateSchema = z
  .object({
    candidateReportId: uuidSchema,
    assessment: z.enum(['possible', 'likely']),
    reason: z.string(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const reportAiReviewSchema = z
  .object({
    status: aiReviewStatusSchema,
    provider: z.string().optional(),
    model: z.string().optional(),
    schemaVersion: z.number().int().positive().optional(),
    submissionRevision: z.number().int().positive().optional(),
    submissionSequence: z.number().int().positive().optional(),
    sourceContentHash: z.string().optional(),
    fingerprint: aiReportFingerprintSchema.optional(),
    summary: z.string().optional(),
    completenessScore: z.number().min(0).max(1).optional(),
    suggestedSeverity: reportSeveritySchema.optional(),
    scopeAssessment: z.enum(['in_scope', 'out_of_scope', 'uncertain']).optional(),
    missingInformation: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    duplicateAssessment: aiDuplicateAssessmentSchema.optional(),
    duplicateConfidence: z.number().min(0).max(1).optional(),
    duplicateCandidates: z.array(aiDuplicateCandidateSchema).max(10).optional(),
    generatedAt: isoDateTimeSchema.optional(),
    persistedAt: isoDateTimeSchema.optional(),
    errorCode: z.string().optional(),
  })
  .strict();
export const reportSummarySchema = z
  .object({
    id: uuidSchema,
    programId: uuidSchema,
    programName: z.string(),
    programSlug: z.string(),
    researcherId: uuidSchema,
    affectedScopeId: uuidSchema,
    title: z.string(),
    proposedSeverity: reportSeveritySchema,
    finalSeverity: reportSeveritySchema.optional(),
    status: reportStatusSchema,
    approvedReward: monetaryAmountSchema.optional(),
    submittedAt: isoDateTimeSchema.optional(),
    paidAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const reportDetailSchema = reportSummarySchema
  .extend({
    description: z.string(),
    reproductionSteps: z.string().optional(),
    secretGistUrl: z.string().optional(),
    severityMismatchAcknowledged: z.boolean(),
    affectedScope: reportAffectedScopeSchema,
    impacts: z.array(reportImpactSchema),
    attachments: z.array(reportAttachmentSchema),
    capabilities: reportCapabilitiesSchema,
    latestInformationRequest: reportInformationRequestSchema.optional(),
    contentHash: z.string(),
    createdAt: isoDateTimeSchema,
    aiReview: reportAiReviewSchema.optional(),
  })
  .strict();

export const reportResponseSchema = z
  .object({ success: z.literal(true), data: reportDetailSchema })
  .strict();

export const reportListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(reportSummarySchema),
    metadata: paginationMetadata,
  })
  .strict();

export const reportProgramFilterOptionSchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    slug: z.string(),
    reportCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const reportProgramFilterOptionsResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(reportProgramFilterOptionSchema),
  })
  .strict();

/**
 * Public "known issues" projection. Derived only from owner-authored disclosure text.
 *
 * Deliberately excludes every private-side field: the report id, the researcher, the decision
 * audit trail (`decidedBy`/`decidedAt`) and the private report body have no public use, so the
 * anonymous surface never carries them. `id` is the disclosure row, not the report.
 */
export const publicDisclosureSchema = z
  .object({
    id: uuidSchema,
    decision: z.enum(['publish_summary', 'publish_full']),
    title: z.string(),
    summary: z.string(),
    content: z.string().optional(),
    severity: reportSeveritySchema,
    publishedAt: isoDateTimeSchema,
  })
  .strict();

export const publicDisclosureListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(publicDisclosureSchema),
    metadata: paginationMetadata,
  })
  .strict();

export type ReportListQuery = z.output<typeof reportListQuerySchema>;
export type CreateReportRequest = z.output<typeof createReportRequestSchema>;
export type UpdateReportRequest = z.output<typeof updateReportRequestSchema>;
export type RequestInformationRequest = z.output<typeof requestInformationRequestSchema>;
export type ValidateReportRequest = z.output<typeof validateReportRequestSchema>;
export type RejectReportRequest = z.output<typeof rejectReportRequestSchema>;
export type MarkDuplicateRequest = z.output<typeof markDuplicateRequestSchema>;
export type ApproveRewardRequest = z.output<typeof approveRewardRequestSchema>;
export type StartPaymentRequest = z.output<typeof startPaymentRequestSchema>;
export type ConfirmPaymentRequest = z.output<typeof confirmPaymentRequestSchema>;
export type DisclosureDecisionRequest = z.output<typeof disclosureDecisionRequestSchema>;
export type AttachmentUploadRequest = z.output<typeof attachmentUploadRequestSchema>;
export type CreateCommentRequest = z.output<typeof createCommentRequestSchema>;
export type CommentListResponse = z.output<typeof commentListResponseSchema>;
export type CreateCommentResponse = z.output<typeof createCommentResponseSchema>;
export type SignedUploadResponse = z.output<typeof signedUploadResponseSchema>;
export type SignedDownloadResponse = z.output<typeof signedDownloadResponseSchema>;
export type ReportComment = z.output<typeof reportCommentSchema>;
export type ReportImpact = z.output<typeof reportImpactSchema>;
export type AiReviewStatus = z.output<typeof aiReviewStatusSchema>;
export type AiDuplicateAssessment = z.output<typeof aiDuplicateAssessmentSchema>;
export type AiReportFingerprint = z.output<typeof aiReportFingerprintSchema>;
export type AiDuplicateCandidate = z.output<typeof aiDuplicateCandidateSchema>;
export type ReportAiReview = z.output<typeof reportAiReviewSchema>;
export type ReportSummary = z.output<typeof reportSummarySchema>;
export type ReportDetail = z.output<typeof reportDetailSchema>;
export type ReportResponse = z.output<typeof reportResponseSchema>;
export type ReportListResponse = z.output<typeof reportListResponseSchema>;
export type ReportProgramFilterOption = z.output<typeof reportProgramFilterOptionSchema>;
export type ReportProgramFilterOptionsResponse = z.output<
  typeof reportProgramFilterOptionsResponseSchema
>;
export type PublicDisclosure = z.output<typeof publicDisclosureSchema>;
export type PublicDisclosureListResponse = z.output<typeof publicDisclosureListResponseSchema>;
