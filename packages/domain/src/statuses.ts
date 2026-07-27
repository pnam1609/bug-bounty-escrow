export const PROGRAM_STATUSES = Object.freeze([
  'draft',
  'awaiting_funding',
  'active',
  'paused',
  'expired',
  'closed',
] as const);

export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

/**
 * Lifecycle as shown to anonymous visitors. `draft`, `awaiting_funding` and `paused` have no
 * public representation at all: those programs must not appear in a public listing.
 */
export const PUBLIC_PROGRAM_STATUSES = Object.freeze(['active', 'ended'] as const);

export type PublicProgramStatus = (typeof PUBLIC_PROGRAM_STATUSES)[number];

const PUBLIC_STATUS_BY_PROGRAM_STATUS: Readonly<Record<ProgramStatus, PublicProgramStatus | null>> =
  Object.freeze({
    draft: null,
    awaiting_funding: null,
    paused: null,
    active: 'active',
    expired: 'ended',
    closed: 'ended',
  });

export function toPublicProgramStatus(status: ProgramStatus): PublicProgramStatus | null {
  return PUBLIC_STATUS_BY_PROGRAM_STATUS[status];
}

export function programStatusesForPublicStatus(
  status: PublicProgramStatus,
): readonly ProgramStatus[] {
  return status === 'active' ? (['active'] as const) : (['expired', 'closed'] as const);
}

export const REPORT_STATUSES = Object.freeze([
  'draft',
  'submitted',
  'triaged',
  'needs_information',
  'rejected',
  'duplicate',
  'validated',
  'reward_approved',
  'payment_pending',
  'paid',
] as const);

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const SEVERITIES = Object.freeze([
  'critical',
  'high',
  'medium',
  'low',
  'informational',
] as const);

export type Severity = (typeof SEVERITIES)[number];

/** Descending order of seriousness; index 0 is the most severe. */
const SEVERITY_RANK: Readonly<Record<Severity, number>> = Object.freeze({
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
});

export function compareSeverity(left: Severity, right: Severity): number {
  return SEVERITY_RANK[left] - SEVERITY_RANK[right];
}

export function highestSeverity(severities: readonly Severity[]): Severity | undefined {
  return [...severities].sort(compareSeverity)[0];
}

export const ASSET_TYPES = Object.freeze(['smart_contract', 'website', 'api', 'mobile'] as const);

export type AssetType = (typeof ASSET_TYPES)[number];

/**
 * Asset types the product currently ships an authoring and submission experience for.
 *
 * `api` and `mobile` stay in `ASSET_TYPES` so stored data and future releases keep working, but
 * neither Create Program nor Submit Bug renders them. Accepting one through the API would create
 * an asset no screen can manage, so write endpoints validate against this narrower list while
 * read endpoints keep accepting the full enum.
 */
export const PRODUCT_ENABLED_ASSET_TYPES = Object.freeze(['smart_contract', 'website'] as const);

export type ProductEnabledAssetType = (typeof PRODUCT_ENABLED_ASSET_TYPES)[number];

const PRODUCT_ENABLED_ASSET_TYPE_SET: ReadonlySet<string> = new Set<string>(
  PRODUCT_ENABLED_ASSET_TYPES,
);

export function isProductEnabledAssetType(value: string): value is ProductEnabledAssetType {
  return PRODUCT_ENABLED_ASSET_TYPE_SET.has(value);
}

export const USER_ROLES = Object.freeze(['owner', 'researcher', 'reviewer'] as const);

export type UserRole = (typeof USER_ROLES)[number];

/** Roles a user may pick for themselves during onboarding. `reviewer` is granted, never chosen. */
export const SELF_ASSIGNABLE_ROLES = Object.freeze(['owner', 'researcher'] as const);

export type SelfAssignableRole = (typeof SELF_ASSIGNABLE_ROLES)[number];

export const REWARD_CALCULATION_TYPES = Object.freeze(['range', 'flat', 'percentage'] as const);

export type RewardCalculationType = (typeof REWARD_CALCULATION_TYPES)[number];

export const PROGRAM_RESOURCE_TYPES = Object.freeze([
  'documentation',
  'repository',
  'audit',
  'website',
  'other',
] as const);

export type ProgramResourceType = (typeof PROGRAM_RESOURCE_TYPES)[number];

export const POC_POLICIES = Object.freeze(['required', 'optional'] as const);

export type PocPolicy = (typeof POC_POLICIES)[number];

export const TOTAL_PAID_VISIBILITIES = Object.freeze(['public', 'private'] as const);

export type TotalPaidVisibility = (typeof TOTAL_PAID_VISIBILITIES)[number];

/** Where a program impact came from: a copied platform template, or written by the owner. */
export const PROGRAM_IMPACT_SOURCES = Object.freeze(['template', 'custom'] as const);

export type ProgramImpactSource = (typeof PROGRAM_IMPACT_SOURCES)[number];

/** Where an impact on a report came from: the program catalog, or proposed by the researcher. */
export const REPORT_IMPACT_SOURCES = Object.freeze(['program', 'custom'] as const);

export type ReportImpactSource = (typeof REPORT_IMPACT_SOURCES)[number];

export const DISCLOSURE_DECISIONS = Object.freeze([
  'keep_private',
  'publish_summary',
  'publish_full',
] as const);

export type DisclosureDecision = (typeof DISCLOSURE_DECISIONS)[number];

export const ATTACHMENT_UPLOAD_STATUSES = Object.freeze([
  'pending',
  'uploaded',
  'failed',
] as const);

export type AttachmentUploadStatus = (typeof ATTACHMENT_UPLOAD_STATUSES)[number];

export const NOTIFICATION_TYPES = Object.freeze([
  'report_submitted',
  'information_requested',
  'report_resubmitted',
  'report_validated',
  'report_rejected',
  'report_duplicate',
  'reward_approved',
  'payment_pending',
  'payment_confirmed',
  'comment_added',
  'program_published',
  'disclosure_published',
] as const);

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const ESCROW_TRANSACTION_TYPES = Object.freeze(['funding', 'payout', 'refund'] as const);

export type EscrowTransactionType = (typeof ESCROW_TRANSACTION_TYPES)[number];

export const ESCROW_TRANSACTION_STATUSES = Object.freeze([
  'pending',
  'confirmed',
  'reverted',
  'timeout',
] as const);

export type EscrowTransactionStatus = (typeof ESCROW_TRANSACTION_STATUSES)[number];

export const ESCROW_DEPLOYMENT_STATUSES = Object.freeze([
  'pending',
  'confirmed',
  'failed',
] as const);

export type EscrowDeploymentStatus = (typeof ESCROW_DEPLOYMENT_STATUSES)[number];
