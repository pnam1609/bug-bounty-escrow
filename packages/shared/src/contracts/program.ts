import {
  ASSET_TYPES,
  POC_POLICIES,
  PRODUCT_ENABLED_ASSET_TYPES,
  PROGRAM_RESOURCE_TYPES,
  PROGRAM_STATUSES,
  PUBLIC_PROGRAM_STATUSES,
  REWARD_CALCULATION_TYPES,
  SEVERITIES,
  TOTAL_PAID_VISIBILITIES,
  PROGRAM_IMPACT_SOURCES,
} from '@bug-bounty-escrow/domain';
import { z } from 'zod';

import {
  DEFAULT_PAGE_NUMBER,
  DEFAULT_PAGE_SIZE,
} from '../constants/pagination.js';
import {
  paginationLimitSchema,
  paginationPageSchema,
  paginationQuerySchema,
} from '../schemas/pagination.js';
import {
  evmAddressSchema,
  httpsUrlSchema,
  isoDateTimeSchema,
  monetaryAmountSchema,
  nonEmptyTrimmedTextSchema,
  storagePathSchema,
  uuidSchema,
} from '../schemas/primitives.js';

export const programStatusSchema = z.enum(PROGRAM_STATUSES);
export const publicProgramStatusSchema = z.enum(PUBLIC_PROGRAM_STATUSES);
export const severitySchema = z.enum(SEVERITIES);
export const assetTypeSchema = z.enum(ASSET_TYPES);
/**
 * Write endpoints only accept the asset types the product actually renders an editor for.
 * Reads still use the full `assetTypeSchema` so stored rows and future types keep deserializing.
 */
export const authorableAssetTypeSchema = z.enum(PRODUCT_ENABLED_ASSET_TYPES);
export const pocPolicySchema = z.enum(POC_POLICIES);
export const rewardCalculationTypeSchema = z.enum(REWARD_CALCULATION_TYPES);
export const programResourceTypeSchema = z.enum(PROGRAM_RESOURCE_TYPES);
export const totalPaidVisibilitySchema = z.enum(TOTAL_PAID_VISIBILITIES);
export const programImpactSourceSchema = z.enum(PROGRAM_IMPACT_SOURCES);

const MAX_SCOPES = 50;
const MAX_TAGS = 10;
const MAX_RESOURCES = 20;
const MAX_IMPACTS = 200;
const MAX_CUSTOM_PROHIBITED_RULES = 20;
/** One tier per (asset type, severity) pair. */
const MAX_REWARD_TIERS = PRODUCT_ENABLED_ASSET_TYPES.length * SEVERITIES.length;

// -------------------------------------------------------------------------------- inputs

export const programScopeInputSchema = z
  .object({
    /** Present when editing an existing scope. Omitted rows are inserted as new scopes. */
    id: uuidSchema.optional(),
    assetType: authorableAssetTypeSchema,
    assetName: nonEmptyTrimmedTextSchema.max(200),
    assetUrl: z.string().url().max(2_000).optional(),
    contractAddress: evmAddressSchema.optional(),
    isInScope: z.boolean().default(true),
    description: z.string().trim().max(2_000).optional(),
    sortOrder: z.number().int().nonnegative().default(0),
  })
  .strict();

export const programResourceInputSchema = z
  .object({
    resourceType: programResourceTypeSchema,
    title: nonEmptyTrimmedTextSchema.max(120),
    url: httpsUrlSchema,
    sortOrder: z.number().int().nonnegative().default(0),
  })
  .strict();

export const programImpactInputSchema = z
  .object({
    id: uuidSchema.optional(),
    assetType: authorableAssetTypeSchema,
    severity: severitySchema,
    title: nonEmptyTrimmedTextSchema.max(300),
    description: z.string().trim().max(2_000).optional(),
    source: programImpactSourceSchema.default('custom'),
    templateKey: z
      .string()
      .regex(/^[a-z][a-z0-9_.-]{0,127}$/)
      .optional(),
    enabled: z.boolean().default(true),
    sortOrder: z.number().int().nonnegative().default(0),
  })
  .strict()
  .superRefine((impact, context) => {
    if ((impact.source === 'template') !== (impact.templateKey !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['templateKey'],
        message: 'A template impact requires a templateKey and a custom impact must omit it',
      });
    }
  });

export const rewardTierInputSchema = z
  .object({
    assetType: authorableAssetTypeSchema,
    severity: severitySchema,
    calculationType: rewardCalculationTypeSchema.default('range'),
    minReward: monetaryAmountSchema.optional(),
    maxReward: monetaryAmountSchema.optional(),
    flatAmount: monetaryAmountSchema.optional(),
    percentageBps: z.number().int().min(1).max(10_000).optional(),
    maxRewardCap: monetaryAmountSchema.optional(),
    calculationNote: z.string().trim().max(2_000).optional(),
  })
  .strict()
  .superRefine((tier, context) => {
    const requirePositive = (value: string | undefined, path: string): void => {
      if (value === undefined || Number(value) <= 0) {
        context.addIssue({ code: 'custom', path: [path], message: 'Enter an amount above zero' });
      }
    };

    /**
     * Exactly one calculation shape may be populated (mirrors the database's
     * `program_reward_tiers_calculation_shape_check`), so a stray amount fails here with a
     * field-level message instead of surfacing as an opaque database check violation.
     */
    const forbidOtherShapes = (paths: readonly (keyof typeof tier)[]): void => {
      for (const path of paths) {
        if (tier[path] !== undefined) {
          context.addIssue({
            code: 'custom',
            path: [path],
            message: `A ${tier.calculationType} tier must not set ${path}`,
          });
        }
      }
    };

    if (tier.calculationType === 'range') {
      forbidOtherShapes(['flatAmount', 'percentageBps', 'maxRewardCap']);

      if (tier.minReward === undefined || tier.maxReward === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['minReward'],
          message: 'A range tier needs a minimum and a maximum reward',
        });
        return;
      }

      if (Number(tier.minReward) > Number(tier.maxReward)) {
        context.addIssue({
          code: 'custom',
          path: ['maxReward'],
          message: 'Maximum reward must not be below minimum reward',
        });
      }
      return;
    }

    if (tier.calculationType === 'flat') {
      forbidOtherShapes(['minReward', 'maxReward', 'percentageBps', 'maxRewardCap']);
      requirePositive(tier.flatAmount, 'flatAmount');
      return;
    }

    forbidOtherShapes(['minReward', 'maxReward', 'flatAmount']);

    if (tier.percentageBps === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['percentageBps'],
        message: 'Enter a percentage greater than 0% and no more than 100%',
      });
    }

    requirePositive(tier.maxRewardCap, 'maxRewardCap');
  });

export const programRulesInputSchema = z
  .object({
    pocPolicy: pocPolicySchema.default('required'),
    pocPolicyNote: z.string().trim().max(2_000).optional(),
    rewardPolicy: nonEmptyTrimmedTextSchema.max(20_000),
    /** Owner additions only. Platform defaults are snapshotted server-side. */
    prohibitedActivities: z
      .array(nonEmptyTrimmedTextSchema.max(1_000))
      .max(MAX_CUSTOM_PROHIBITED_RULES)
      .default([]),
    testingRestrictions: z.string().trim().max(10_000).optional(),
    submissionAcknowledgment: z.string().trim().max(1_000).optional(),
    allowCustomImpact: z.boolean().default(true),
  })
  .strict();

const programTagSchema = nonEmptyTrimmedTextSchema.max(40);

/**
 * Duplicate detection must agree with the database, where `program_impacts.normalized_title` is
 * `btrim(regexp_replace(lower(btrim(title)), '[^a-z0-9]+', ' ', 'g'))`. Diverging here would let
 * a payload pass validation and then die on the unique constraint with a generic error.
 */
function normalizeImpactTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Every asset type that has a live in-scope asset must be priced and must offer at least one
 * enabled impact, otherwise a researcher could pick an asset they cannot describe or be paid for.
 * The database enforces the same rule; this check exists to fail early with a field-level message.
 */
function assertAssetTypeCoverage(
  program: {
    readonly scopes: readonly z.output<typeof programScopeInputSchema>[];
    readonly impacts: readonly z.output<typeof programImpactInputSchema>[];
    readonly rewardTiers: readonly z.output<typeof rewardTierInputSchema>[];
  },
  context: z.RefinementCtx,
): void {
  const liveAssetTypes = new Set(
    program.scopes.filter((scope) => scope.isInScope).map((scope) => scope.assetType),
  );

  for (const assetType of liveAssetTypes) {
    const hasImpact = program.impacts.some(
      (impact) => impact.assetType === assetType && impact.enabled,
    );

    if (!hasImpact) {
      context.addIssue({
        code: 'custom',
        path: ['impacts'],
        message: `Add at least one impact for ${assetType}`,
      });
    }

    if (!program.rewardTiers.some((tier) => tier.assetType === assetType)) {
      context.addIssue({
        code: 'custom',
        path: ['rewardTiers'],
        message: `Add at least one reward tier for ${assetType}`,
      });
    }
  }

  const tierKeys = program.rewardTiers.map((tier) => `${tier.assetType}:${tier.severity}`);

  if (new Set(tierKeys).size !== tierKeys.length) {
    context.addIssue({
      code: 'custom',
      path: ['rewardTiers'],
      message: 'Each severity can only be used once per asset type',
    });
  }

  const impactKeys = program.impacts.map(
    (impact) => `${impact.assetType}:${normalizeImpactTitle(impact.title)}`,
  );

  if (new Set(impactKeys).size !== impactKeys.length) {
    context.addIssue({
      code: 'custom',
      path: ['impacts'],
      message: 'This impact is already listed for this asset type',
    });
  }
}

export const createProgramRequestSchema = z
  .object({
    name: nonEmptyTrimmedTextSchema.max(200),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    shortSummary: nonEmptyTrimmedTextSchema.max(280),
    description: nonEmptyTrimmedTextSchema.max(20_000),
    websiteUrl: httpsUrlSchema,
    logoStoragePath: storagePathSchema.optional(),
    tags: z.array(programTagSchema).min(1).max(MAX_TAGS),
    /** Optional; when supplied it must still lie in the future at submission time. */
    deadline: isoDateTimeSchema
      .refine(
        (value) => new Date(value).getTime() > Date.now(),
        'Choose a valid future date or leave it empty',
      )
      .optional(),
    resources: z.array(programResourceInputSchema).max(MAX_RESOURCES).default([]),
    scopes: z.array(programScopeInputSchema).min(1).max(MAX_SCOPES),
    impacts: z.array(programImpactInputSchema).min(1).max(MAX_IMPACTS),
    rewardTiers: z.array(rewardTierInputSchema).min(1).max(MAX_REWARD_TIERS),
    rules: programRulesInputSchema,
  })
  .strict()
  .superRefine((program, context) => {
    if (!program.scopes.some((scope) => scope.isInScope)) {
      context.addIssue({
        code: 'custom',
        path: ['scopes'],
        message: 'Add at least one in-scope asset',
      });
    }

    assertAssetTypeCoverage(program, context);

    // A new program has no stored scopes yet, so every impact and tier must target an asset
    // type present in this very payload. Updates are exempt: archived scopes survive server-side
    // and the database owns that reconciliation.
    const scopedAssetTypes = new Set(program.scopes.map((scope) => scope.assetType));

    program.impacts.forEach((impact, index) => {
      if (!scopedAssetTypes.has(impact.assetType)) {
        context.addIssue({
          code: 'custom',
          path: ['impacts', index, 'assetType'],
          message: 'This impact targets an asset type with no scope entry',
        });
      }
    });

    program.rewardTiers.forEach((tier, index) => {
      if (!scopedAssetTypes.has(tier.assetType)) {
        context.addIssue({
          code: 'custom',
          path: ['rewardTiers', index, 'assetType'],
          message: 'This reward tier targets an asset type with no scope entry',
        });
      }
    });
  });

export const updateProgramRequestSchema = z
  .object({
    name: nonEmptyTrimmedTextSchema.max(200).optional(),
    shortSummary: nonEmptyTrimmedTextSchema.max(280).optional(),
    description: nonEmptyTrimmedTextSchema.max(20_000).optional(),
    websiteUrl: httpsUrlSchema.optional(),
    logoStoragePath: storagePathSchema.nullable().optional(),
    tags: z.array(programTagSchema).min(1).max(MAX_TAGS).optional(),
    deadline: isoDateTimeSchema.nullable().optional(),
    totalPaidVisibility: totalPaidVisibilitySchema.optional(),
    resources: z.array(programResourceInputSchema).max(MAX_RESOURCES).optional(),
    scopes: z.array(programScopeInputSchema).min(1).max(MAX_SCOPES).optional(),
    impacts: z.array(programImpactInputSchema).min(1).max(MAX_IMPACTS).optional(),
    rewardTiers: z.array(rewardTierInputSchema).min(1).max(MAX_REWARD_TIERS).optional(),
    rules: programRulesInputSchema.partial().optional(),
    /** Optimistic concurrency token; the server rejects a stale value with 409. */
    expectedUpdatedAt: isoDateTimeSchema,
  })
  .strict()
  .superRefine((program, context) => {
    // Only validate coverage when the caller sent all three collections; a partial update of one
    // of them is checked against stored state by the database instead.
    if (
      program.scopes !== undefined &&
      program.impacts !== undefined &&
      program.rewardTiers !== undefined
    ) {
      assertAssetTypeCoverage(
        { scopes: program.scopes, impacts: program.impacts, rewardTiers: program.rewardTiers },
        context,
      );
    }
  });

// -------------------------------------------------------------------------------- queries

export const programIdParamsSchema = z.object({ id: uuidSchema }).strict();

/** Repeatable query values arrive either as `?a=1&a=2`, `?a=1,2`, or a single value. */
function enumListQuerySchema<T extends readonly [string, ...string[]]>(values: T) {
  return z
    .preprocess(
      (raw) => {
        if (raw === undefined || raw === null) {
          return undefined;
        }

        const list = Array.isArray(raw) ? raw : String(raw).split(',');
        const cleaned = list.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);

        return cleaned.length === 0 ? undefined : cleaned;
      },
      z.array(z.enum(values)).min(1).optional(),
    )
    .catch(undefined);
}

/** `z.coerce.boolean()` maps the string "false" to true, so parse the token explicitly. */
const booleanQuerySchema = z
  .preprocess((raw) => {
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }

    const token = String(raw).trim().toLowerCase();

    if (token === 'true' || token === '1') {
      return true;
    }

    if (token === 'false' || token === '0') {
      return false;
    }

    return raw;
  }, z.boolean().optional())
  .catch(undefined);

export const programSortSchema = z.enum(['newest', 'deadline', 'name', 'maxBounty', 'totalPaid']);

export const programListQuerySchema = paginationQuerySchema
  .extend({
    // The public discovery URL is user-editable/shareable. Invalid values degrade to this safe
    // default view instead of turning a public page into a 400/500 response.
    page: paginationPageSchema.default(DEFAULT_PAGE_NUMBER).catch(DEFAULT_PAGE_NUMBER),
    limit: paginationLimitSchema.default(DEFAULT_PAGE_SIZE).catch(DEFAULT_PAGE_SIZE),
    search: z.string().trim().max(120).optional().catch(undefined),
    sort: programSortSchema.default('newest').catch('newest'),
    sortDirection: z.enum(['asc', 'desc']).optional().catch(undefined),
    /** Public lifecycle filter. Defaults to both active and ended, active ordered first. */
    status: enumListQuerySchema(PUBLIC_PROGRAM_STATUSES),
    assetType: enumListQuerySchema(ASSET_TYPES),
    severity: enumListQuerySchema(SEVERITIES),
    minMaxReward: monetaryAmountSchema.optional().catch(undefined),
    closing: z.enum(['7d', '30d', 'ongoing']).optional().catch(undefined),
    funded: booleanQuerySchema,
  })
  .strict();

/** Owner workspace listing; unlike the public list it exposes every internal status. */
export const ownerProgramListQuerySchema = paginationQuerySchema
  .extend({
    search: z.string().trim().max(120).optional(),
    status: programStatusSchema.optional(),
    sort: z.enum(['newest', 'name', 'deadline']).default('newest'),
  })
  .strict();

// -------------------------------------------------------------------------------- lifecycle

export const deployEscrowRequestSchema = z
  .object({
    chainId: z.number().int().positive(),
    contractAddress: evmAddressSchema,
    transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  })
  .strict();

export const fundProgramRequestSchema = z
  .object({
    amount: monetaryAmountSchema.refine((value) => Number(value) > 0, 'Enter an amount above zero'),
    transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    tokenAddress: evmAddressSchema,
  })
  .strict();

export const programStatusChangeRequestSchema = z
  .object({ status: z.enum(['awaiting_funding', 'paused', 'expired', 'closed']) })
  .strict();

export const assignReviewerRequestSchema = z.object({ reviewerId: uuidSchema }).strict();

export const programReviewerParamsSchema = z
  .object({ id: uuidSchema, reviewerId: uuidSchema })
  .strict();

export const logoUploadRequestSchema = z
  .object({
    filename: nonEmptyTrimmedTextSchema
      .max(255)
      .refine(
        (value) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(value),
        'Filename may only contain letters, numbers, dots, dashes and underscores',
      ),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(2 * 1024 * 1024),
  })
  .strict();

// -------------------------------------------------------------------------------- responses

export const programScopeSchema = z
  .object({
    id: uuidSchema,
    assetType: assetTypeSchema,
    assetName: z.string(),
    assetUrl: z.string().optional(),
    contractAddress: z.string().optional(),
    isInScope: z.boolean(),
    description: z.string().optional(),
    sortOrder: z.number().int().nonnegative(),
    archived: z.boolean(),
  })
  .strict();

export const programResourceSchema = z
  .object({
    id: uuidSchema,
    resourceType: programResourceTypeSchema,
    title: z.string(),
    url: z.string(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();

export const programImpactSchema = z
  .object({
    id: uuidSchema,
    assetType: assetTypeSchema,
    severity: severitySchema,
    title: z.string(),
    description: z.string().optional(),
    source: programImpactSourceSchema,
    templateKey: z.string().optional(),
    enabled: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();

export const rewardTierSchema = z
  .object({
    assetType: assetTypeSchema,
    severity: severitySchema,
    calculationType: rewardCalculationTypeSchema,
    minReward: monetaryAmountSchema.optional(),
    maxReward: monetaryAmountSchema.optional(),
    flatAmount: monetaryAmountSchema.optional(),
    percentageBps: z.number().int().optional(),
    maxRewardCap: monetaryAmountSchema.optional(),
    calculationNote: z.string().optional(),
  })
  .strict();

export const prohibitedActivitySchema = z
  .object({
    id: uuidSchema,
    source: z.enum(['platform_default', 'custom']),
    ruleKey: z.string().optional(),
    body: z.string(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();

export const programRulesSchema = z
  .object({
    pocPolicy: pocPolicySchema,
    pocPolicyNote: z.string().optional(),
    rewardPolicy: z.string().optional(),
    testingRestrictions: z.string().optional(),
    submissionAcknowledgment: z.string().optional(),
    allowCustomImpact: z.boolean(),
    prohibitedActivities: z.array(prohibitedActivitySchema),
  })
  .strict();

/** Shape shared by the public list row and the full program detail. */
export const programSummarySchema = z
  .object({
    id: uuidSchema,
    name: z.string(),
    slug: z.string(),
    shortSummary: z.string(),
    status: programStatusSchema,
    publicStatus: publicProgramStatusSchema.nullable(),
    logoUrl: z.string().optional(),
    tags: z.array(z.string()),
    totalPool: monetaryAmountSchema,
    reservedPool: monetaryAmountSchema,
    remainingPool: monetaryAmountSchema,
    /** Null when the owner keeps the figure private; never a real value hidden client-side. */
    totalPaid: monetaryAmountSchema.nullable(),
    totalPaidVisibility: totalPaidVisibilitySchema,
    paidReportCount: z.number().int().nonnegative().nullable(),
    maxBounty: monetaryAmountSchema,
    inScopeAssetTypes: z.array(assetTypeSchema),
    rewardSeverities: z.array(severitySchema),
    deadline: isoDateTimeSchema.optional(),
    publishedAt: isoDateTimeSchema.optional(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

/** Server-derived figures the owner never enters. */
export const programMetricsSchema = z
  .object({
    totalAssetsInScope: z.number().int().nonnegative(),
    /**
     * Median seconds from initial submission to the first rejected, duplicate, or validated
     * review decision. Reward approval and payment time are excluded. Null until at least one
     * report has reached one of those decisions.
     */
    medianResolutionSeconds: z.number().int().nonnegative().nullable(),
  })
  .strict();

export const programSchema = programSummarySchema
  .extend({
    ownerId: uuidSchema,
    description: z.string(),
    websiteUrl: z.string().optional(),
    contractAddress: z.string().optional(),
    createdAt: isoDateTimeSchema,
    scopes: z.array(programScopeSchema),
    impacts: z.array(programImpactSchema),
    rewardTiers: z.array(rewardTierSchema),
    resources: z.array(programResourceSchema),
    rules: programRulesSchema,
    metrics: programMetricsSchema,
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

export const programResponseSchema = z
  .object({ success: z.literal(true), data: programSchema })
  .strict();

export const programListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(programSummarySchema),
    metadata: paginationMetadata,
  })
  .strict();

export const programReviewerSchema = z
  .object({
    reviewerId: uuidSchema,
    displayName: z.string(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const programReviewerListResponseSchema = z
  .object({ success: z.literal(true), data: z.array(programReviewerSchema) })
  .strict();

export const escrowTransactionSchema = z
  .object({
    id: uuidSchema,
    programId: uuidSchema,
    reportId: uuidSchema.optional(),
    chainId: z.number().int().positive(),
    transactionHash: z.string(),
    type: z.enum(['funding', 'payout', 'refund']),
    status: z.enum(['pending', 'confirmed', 'reverted', 'timeout']),
    amount: monetaryAmountSchema,
    tokenAddress: z.string(),
    createdAt: isoDateTimeSchema,
    confirmedAt: isoDateTimeSchema.optional(),
  })
  .strict();

export const escrowTransactionListResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(escrowTransactionSchema),
    metadata: paginationMetadata,
  })
  .strict();

export const escrowTransactionResponseSchema = z
  .object({ success: z.literal(true), data: escrowTransactionSchema })
  .strict();

export const transactionHashParamsSchema = z
  .object({ hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
  .strict();

export const signedLogoUploadResponseSchema = z
  .object({
    success: z.literal(true),
    data: z
      .object({
        storagePath: z.string(),
        uploadUrl: z.string().url(),
        expiresAt: isoDateTimeSchema,
      })
      .strict(),
  })
  .strict();

export type ProgramListQuery = z.output<typeof programListQuerySchema>;
export type OwnerProgramListQuery = z.output<typeof ownerProgramListQuerySchema>;
export type ProgramIdParams = z.output<typeof programIdParamsSchema>;
export type ProgramReviewerParams = z.output<typeof programReviewerParamsSchema>;
export type TransactionHashParams = z.output<typeof transactionHashParamsSchema>;
export type CreateProgramRequest = z.output<typeof createProgramRequestSchema>;
export type UpdateProgramRequest = z.output<typeof updateProgramRequestSchema>;
export type DeployEscrowRequest = z.output<typeof deployEscrowRequestSchema>;
export type FundProgramRequest = z.output<typeof fundProgramRequestSchema>;
export type ProgramStatusChangeRequest = z.output<typeof programStatusChangeRequestSchema>;
export type AssignReviewerRequest = z.output<typeof assignReviewerRequestSchema>;
export type LogoUploadRequest = z.output<typeof logoUploadRequestSchema>;
export type AuthorableAssetType = z.output<typeof authorableAssetTypeSchema>;
export type ProgramScopeInput = z.output<typeof programScopeInputSchema>;
export type ProgramImpactInput = z.output<typeof programImpactInputSchema>;
export type RewardTierInput = z.output<typeof rewardTierInputSchema>;
export type ProgramMetrics = z.output<typeof programMetricsSchema>;
export type ProgramSummary = z.output<typeof programSummarySchema>;
export type Program = z.output<typeof programSchema>;
export type ProgramResponse = z.output<typeof programResponseSchema>;
export type ProgramListResponse = z.output<typeof programListResponseSchema>;
export type ProgramReviewer = z.output<typeof programReviewerSchema>;
export type ProgramReviewerListResponse = z.output<typeof programReviewerListResponseSchema>;
export type EscrowTransaction = z.output<typeof escrowTransactionSchema>;
export type EscrowTransactionListResponse = z.output<typeof escrowTransactionListResponseSchema>;
export type EscrowTransactionResponse = z.output<typeof escrowTransactionResponseSchema>;
export type SignedLogoUploadResponse = z.output<typeof signedLogoUploadResponseSchema>;
