import { ARC_TESTNET_CHAIN_ID, ARC_TESTNET_USDC_ADDRESS } from '@bug-bounty-escrow/shared';
import type {
  Program,
  ProgramSummary,
  ProgramScopeInput,
  RewardTierInput,
} from '@bug-bounty-escrow/shared';

export const PROGRAM_SUMMARY_PROJECTION = [
  'id',
  'owner_id',
  'name',
  'slug',
  'short_summary',
  'status',
  'public_status',
  'logo_storage_path',
  'total_pool',
  'reserved_pool',
  'paid_pool',
  'available_pool',
  'paid_report_count',
  'total_paid_visibility',
  'max_bounty',
  'in_scope_asset_types',
  'reward_severities',
  'deadline',
  'published_at',
  'updated_at',
  'program_tags(label)',
].join(',');

export const PROGRAM_DETAIL_PROJECTION = [
  PROGRAM_SUMMARY_PROJECTION,
  'description',
  'website_url',
  'contract_address',
  'escrow_contracts(chain_id,deployment_status,contract_address,token_address,contract_version)',
  'created_at',
  'poc_policy',
  'poc_policy_note',
  'reward_policy',
  'testing_restrictions',
  'submission_acknowledgment',
  'allow_custom_impact',
  'program_scopes(id,asset_type,asset_name,asset_url,contract_address,is_in_scope,description,sort_order,archived_at)',
  'program_impacts(id,asset_type,severity,title,description,source,template_key,enabled,sort_order,archived_at)',
  'program_reward_tiers(asset_type,severity,calculation_type,min_reward,max_reward,flat_amount,percentage_bps,max_reward_cap,calculation_note,archived_at)',
  'program_resources(id,resource_type,title,url,sort_order)',
  'program_prohibited_activities(id,source,rule_key,body,sort_order)',
].join(',');

type Numeric = number | string;

export interface ProgramSummaryRow {
  readonly id: string;
  readonly owner_id: string;
  readonly name: string;
  readonly slug: string;
  readonly short_summary: string;
  readonly status: Program['status'];
  readonly public_status: Program['publicStatus'];
  readonly logo_storage_path: string | null;
  readonly total_pool: Numeric;
  readonly reserved_pool: Numeric;
  readonly paid_pool: Numeric;
  readonly available_pool: Numeric;
  readonly paid_report_count: number;
  readonly total_paid_visibility: Program['totalPaidVisibility'];
  readonly max_bounty: Numeric;
  readonly in_scope_asset_types: Program['inScopeAssetTypes'];
  readonly reward_severities: Program['rewardSeverities'];
  readonly deadline: string | null;
  readonly published_at: string | null;
  readonly updated_at: string;
  readonly program_tags: Array<{ label: string }>;
}

export interface ProgramDetailRow extends ProgramSummaryRow {
  readonly description: string;
  readonly website_url: string | null;
  readonly contract_address: string | null;
  readonly escrow_contracts?: Array<{
    readonly chain_id: number | string;
    readonly deployment_status: string;
    readonly contract_address: string | null;
    readonly token_address: string | null;
    readonly contract_version: string | null;
  }>;
  readonly created_at: string;
  readonly poc_policy: Program['rules']['pocPolicy'];
  readonly poc_policy_note: string | null;
  readonly reward_policy: string | null;
  readonly testing_restrictions: string | null;
  readonly submission_acknowledgment: string | null;
  readonly allow_custom_impact: boolean;
  readonly program_scopes: Array<{
    id: string;
    asset_type: ProgramScopeInput['assetType'];
    asset_name: string;
    asset_url: string | null;
    contract_address: string | null;
    is_in_scope: boolean;
    description: string | null;
    sort_order: number;
    archived_at: string | null;
  }>;
  readonly program_impacts: Array<{
    id: string;
    asset_type: ProgramScopeInput['assetType'];
    severity: RewardTierInput['severity'];
    title: string;
    description: string | null;
    source: 'template' | 'custom';
    template_key: string | null;
    enabled: boolean;
    sort_order: number;
    archived_at: string | null;
  }>;
  readonly program_reward_tiers: Array<{
    asset_type: RewardTierInput['assetType'];
    severity: RewardTierInput['severity'];
    calculation_type: RewardTierInput['calculationType'];
    min_reward: Numeric | null;
    max_reward: Numeric | null;
    flat_amount: Numeric | null;
    percentage_bps: number | null;
    max_reward_cap: Numeric | null;
    calculation_note: string | null;
    archived_at: string | null;
  }>;
  readonly program_resources: Array<{
    id: string;
    resource_type: Program['resources'][number]['resourceType'];
    title: string;
    url: string;
    sort_order: number;
  }>;
  readonly program_prohibited_activities: Array<{
    id: string;
    source: 'platform_default' | 'custom';
    rule_key: string | null;
    body: string;
    sort_order: number;
  }>;
}

export interface MapOptions {
  /**
   * Owners and assigned reviewers always see the settled total. Public reads only see it when
   * the owner opted in; the value is dropped here rather than hidden in the UI.
   */
  readonly revealTotalPaid: boolean;
  readonly resolveLogoUrl: (storagePath: string | null) => string | undefined;
  /** Median time to the first rejected, duplicate, or validated review decision. */
  readonly medianResolutionSeconds?: number | null;
}

export function money(value: Numeric | null): string {
  if (value === null) {
    return '0';
  }

  return typeof value === 'string' ? value : value.toFixed(6);
}

export function mapProgramSummary(row: ProgramSummaryRow, options: MapOptions): ProgramSummary {
  const isPublicTotal = row.total_paid_visibility === 'public';
  const revealTotal = options.revealTotalPaid || isPublicTotal;
  const logoUrl = options.resolveLogoUrl(row.logo_storage_path);

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    shortSummary: row.short_summary,
    status: row.status,
    publicStatus: row.public_status,
    ...(logoUrl === undefined ? {} : { logoUrl }),
    tags: (row.program_tags ?? []).map((tag) => tag.label),
    totalPool: money(row.total_pool),
    reservedPool: money(row.reserved_pool),
    remainingPool: money(row.available_pool),
    totalPaid: revealTotal ? money(row.paid_pool) : null,
    totalPaidVisibility: row.total_paid_visibility,
    paidReportCount: revealTotal ? row.paid_report_count : null,
    maxBounty: money(row.max_bounty),
    inScopeAssetTypes: row.in_scope_asset_types ?? [],
    rewardSeverities: row.reward_severities ?? [],
    ...(row.deadline === null ? {} : { deadline: row.deadline }),
    ...(row.published_at === null ? {} : { publishedAt: row.published_at }),
    updatedAt: row.updated_at,
  };
}

export function mapProgramDetail(row: ProgramDetailRow, options: MapOptions): Program {
  const liveScopes = (row.program_scopes ?? []).filter(
    (scope) => scope.is_in_scope && scope.archived_at === null,
  );
  const canonicalEscrow = (row.escrow_contracts ?? []).find(
    (escrow) =>
      Number(escrow.chain_id) === ARC_TESTNET_CHAIN_ID &&
      escrow.deployment_status === 'confirmed' &&
      escrow.contract_version === '1.1.0' &&
      escrow.token_address?.toLowerCase() === ARC_TESTNET_USDC_ADDRESS.toLowerCase() &&
      escrow.contract_address !== null,
  );

  return {
    ...mapProgramSummary(row, options),
    ownerId: row.owner_id,
    description: row.description,
    ...(row.website_url === null ? {} : { websiteUrl: row.website_url }),
    ...(canonicalEscrow?.contract_address === undefined || canonicalEscrow.contract_address === null
      ? {}
      : { escrowAddress: canonicalEscrow.contract_address }),
    ...(row.contract_address === null ? {} : { contractAddress: row.contract_address }),
    createdAt: row.created_at,
    scopes: [...(row.program_scopes ?? [])]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((scope) => ({
        id: scope.id,
        assetType: scope.asset_type,
        assetName: scope.asset_name,
        ...(scope.asset_url === null ? {} : { assetUrl: scope.asset_url }),
        ...(scope.contract_address === null ? {} : { contractAddress: scope.contract_address }),
        isInScope: scope.is_in_scope,
        ...(scope.description === null ? {} : { description: scope.description }),
        sortOrder: scope.sort_order,
        archived: scope.archived_at !== null,
      })),
    impacts: [...(row.program_impacts ?? [])]
      .filter((impact) => impact.archived_at === null)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((impact) => ({
        id: impact.id,
        assetType: impact.asset_type,
        severity: impact.severity,
        title: impact.title,
        ...(impact.description === null ? {} : { description: impact.description }),
        source: impact.source,
        ...(impact.template_key === null ? {} : { templateKey: impact.template_key }),
        enabled: impact.enabled,
        sortOrder: impact.sort_order,
      })),
    // Archived tiers still price the reports they were approved under, but they are no longer
    // part of the program's published pricing.
    rewardTiers: (row.program_reward_tiers ?? [])
      .filter((tier) => tier.archived_at === null)
      .map((tier) => ({
        assetType: tier.asset_type,
        severity: tier.severity,
        calculationType: tier.calculation_type,
        ...(tier.min_reward === null ? {} : { minReward: money(tier.min_reward) }),
        ...(tier.max_reward === null ? {} : { maxReward: money(tier.max_reward) }),
        ...(tier.flat_amount === null ? {} : { flatAmount: money(tier.flat_amount) }),
        ...(tier.percentage_bps === null ? {} : { percentageBps: tier.percentage_bps }),
        ...(tier.max_reward_cap === null ? {} : { maxRewardCap: money(tier.max_reward_cap) }),
        ...(tier.calculation_note === null ? {} : { calculationNote: tier.calculation_note }),
      })),
    resources: [...(row.program_resources ?? [])]
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((resource) => ({
        id: resource.id,
        resourceType: resource.resource_type,
        title: resource.title,
        url: resource.url,
        sortOrder: resource.sort_order,
      })),
    rules: {
      pocPolicy: row.poc_policy,
      ...(row.poc_policy_note === null ? {} : { pocPolicyNote: row.poc_policy_note }),
      ...(row.reward_policy === null ? {} : { rewardPolicy: row.reward_policy }),
      ...(row.testing_restrictions === null
        ? {}
        : { testingRestrictions: row.testing_restrictions }),
      ...(row.submission_acknowledgment === null
        ? {}
        : { submissionAcknowledgment: row.submission_acknowledgment }),
      allowCustomImpact: row.allow_custom_impact,
      prohibitedActivities: [...(row.program_prohibited_activities ?? [])]
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((rule) => ({
          id: rule.id,
          source: rule.source,
          ...(rule.rule_key === null ? {} : { ruleKey: rule.rule_key }),
          body: rule.body,
          sortOrder: rule.sort_order,
        })),
    },
    metrics: {
      totalAssetsInScope: liveScopes.length,
      medianResolutionSeconds: options.medianResolutionSeconds ?? null,
    },
  };
}
