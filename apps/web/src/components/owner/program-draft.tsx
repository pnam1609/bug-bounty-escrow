/*
 * Client-side model for the Create Program wizard.
 *
 * Source of truth for behaviour: docs/flow/create-program-owner-flow-for-figma.md. Every copy
 * string that the flow document quotes verbatim is reproduced verbatim here.
 *
 * The wizard holds structured rows — never a JSON blob — and only converts to the API contract
 * (`createProgramRequestSchema` / `updateProgramRequestSchema`) at the Review step.
 */

import {
  IMPACT_TEMPLATES as DOMAIN_IMPACT_TEMPLATES,
  PLATFORM_PROHIBITED_ACTIVITIES as DOMAIN_PROHIBITED_ACTIVITIES,
} from '@bug-bounty-escrow/shared';
import type {
  AuthorableAssetType,
  ImpactTemplate as DomainImpactTemplate,
  Program,
  Severity,
} from '@bug-bounty-escrow/shared';

/* ── Enumerations the API accepts ──────────────────────────────────────────────────────────── */

/**
 * `api` and `mobile` exist in the domain enum for future releases but no editor renders them, so
 * write endpoints reject them. The wizard offers exactly these two.
 */
export const AUTHORABLE_ASSET_TYPES: readonly AuthorableAssetType[] = ['smart_contract', 'website'];

export const ASSET_TYPE_LABELS: Readonly<Record<AuthorableAssetType, string>> = {
  smart_contract: 'Smart contract',
  website: 'Website',
};

/** Plural form used on the filter tabs. */
export const ASSET_TYPE_TAB_LABELS: Readonly<Record<AuthorableAssetType, string>> = {
  smart_contract: 'Smart contracts',
  website: 'Websites',
};

/** Descending seriousness — the order every severity list in the flow is drawn in. */
export const SEVERITY_ORDER: readonly Severity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'informational',
];

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Informational',
};

export type ResourceType = 'documentation' | 'repository' | 'audit' | 'website' | 'other';

export const RESOURCE_TYPES: readonly ResourceType[] = [
  'documentation',
  'repository',
  'audit',
  'website',
  'other',
];

export const RESOURCE_TYPE_LABELS: Readonly<Record<ResourceType, string>> = {
  documentation: 'Documentation',
  repository: 'Repository',
  audit: 'Audit',
  website: 'Website',
  other: 'Other',
};

export type CalculationType = 'range' | 'flat' | 'percentage';

export const CALCULATION_TYPE_LABELS: Readonly<Record<CalculationType, string>> = {
  range: 'Range',
  flat: 'Flat',
  percentage: 'Percentage with cap',
};

export type PocPolicy = 'required' | 'optional';

/* ── Platform catalogues ───────────────────────────────────────────────────────────────────── */

/*
 * The impact catalogue and the platform prohibited-activity baseline come from the domain package
 * through @bug-bounty-escrow/shared. They were briefly copied into this file, which is a real
 * hazard: the server snapshots `templateKey` into `program_impacts`, so a drifted copy would
 * silently produce impacts whose provenance no longer resolves.
 */
export type ImpactTemplate = Omit<DomainImpactTemplate, 'assetType'> & {
  readonly assetType: AuthorableAssetType;
};

export const PLATFORM_PROHIBITED_ACTIVITIES: readonly string[] = DOMAIN_PROHIBITED_ACTIVITIES.map(
  (rule) => rule.body,
);

/** Narrowed to the asset types the product actually renders an editor for. */
export const IMPACT_TEMPLATES: readonly ImpactTemplate[] = DOMAIN_IMPACT_TEMPLATES.filter(
  (template): template is ImpactTemplate =>
    template.assetType === 'smart_contract' || template.assetType === 'website',
);

/* ── Draft rows ────────────────────────────────────────────────────────────────────────────── */

export interface ResourceRow {
  readonly rowId: string;
  readonly resourceType: ResourceType;
  readonly title: string;
  readonly url: string;
}

export interface ScopeRow {
  readonly rowId: string;
  /** Present when the row already exists server-side; keeps report references stable. */
  readonly id?: string;
  readonly assetType: AuthorableAssetType;
  readonly assetName: string;
  readonly assetUrl: string;
  readonly contractAddress: string;
  readonly isInScope: boolean;
  readonly description: string;
}

export interface ImpactRow {
  readonly rowId: string;
  readonly id?: string;
  readonly assetType: AuthorableAssetType;
  readonly severity: Severity;
  readonly title: string;
  readonly description: string;
  readonly templateKey?: string;
  readonly enabled: boolean;
}

export interface TierRow {
  readonly rowId: string;
  readonly assetType: AuthorableAssetType;
  readonly severity: Severity;
  readonly calculationType: CalculationType;
  readonly minReward: string;
  readonly maxReward: string;
  readonly flatAmount: string;
  /** Whole percent as typed by the owner, e.g. `10`. Converted to basis points on submit. */
  readonly percentage: string;
  readonly maxRewardCap: string;
  readonly calculationNote: string;
}

export interface ProhibitedRuleRow {
  readonly rowId: string;
  readonly body: string;
}

export interface RulesDraft {
  readonly pocPolicy: PocPolicy;
  readonly pocPolicyNote: string;
  readonly rewardPolicy: string;
  readonly prohibitedActivities: readonly ProhibitedRuleRow[];
  readonly testingRestrictions: string;
  readonly submissionAcknowledgment: string;
  readonly allowCustomImpact: boolean;
}

export interface ProgramDraft {
  readonly name: string;
  readonly slug: string;
  /** Once the owner edits the slug the suggestion stops following the name. */
  readonly slugEdited: boolean;
  readonly shortSummary: string;
  readonly websiteUrl: string;
  readonly description: string;
  readonly tags: readonly string[];
  /** `yyyy-mm-dd` from the date control; converted to an ISO instant on submit. */
  readonly deadline: string;
  readonly logoFile: File | null;
  readonly logoPreviewUrl: string | null;
  readonly resources: readonly ResourceRow[];
  readonly scopes: readonly ScopeRow[];
  readonly impacts: readonly ImpactRow[];
  readonly rewardTiers: readonly TierRow[];
  readonly rules: RulesDraft;
}

/*
 * Row keys are generated from a module counter rather than `crypto.randomUUID()` so that the same
 * initial draft renders identically on the server and on the client.
 */
let rowSequence = 0;

export function nextRowId(prefix: string): string {
  rowSequence += 1;
  return `${prefix}-${rowSequence}`;
}

export function createEmptyDraft(): ProgramDraft {
  return {
    name: '',
    slug: '',
    slugEdited: false,
    shortSummary: '',
    websiteUrl: '',
    description: '',
    tags: [],
    deadline: '',
    logoFile: null,
    logoPreviewUrl: null,
    resources: [],
    scopes: [],
    impacts: [],
    rewardTiers: [],
    rules: {
      pocPolicy: 'required',
      pocPolicyNote: '',
      rewardPolicy: '',
      prohibitedActivities: [],
      testingRestrictions: '',
      submissionAcknowledgment: '',
      allowCustomImpact: true,
    },
  };
}

function isAuthorable(value: string): value is AuthorableAssetType {
  return value === 'smart_contract' || value === 'website';
}

/** Rehydrates the wizard from a saved program so `Edit program` reopens the same editors. */
export function draftFromProgram(program: Program): ProgramDraft {
  return {
    name: program.name,
    slug: program.slug,
    slugEdited: true,
    shortSummary: program.shortSummary,
    websiteUrl: program.websiteUrl ?? '',
    description: program.description,
    tags: [...program.tags],
    deadline: program.deadline === undefined ? '' : program.deadline.slice(0, 10),
    logoFile: null,
    logoPreviewUrl: program.logoUrl ?? null,
    resources: program.resources.map((resource) => ({
      rowId: nextRowId('resource'),
      resourceType: resource.resourceType,
      title: resource.title,
      url: resource.url,
    })),
    scopes: program.scopes
      .filter((scope) => !scope.archived && isAuthorable(scope.assetType))
      .map((scope) => ({
        rowId: nextRowId('scope'),
        id: scope.id,
        assetType: scope.assetType as AuthorableAssetType,
        assetName: scope.assetName,
        assetUrl: scope.assetUrl ?? '',
        contractAddress: scope.contractAddress ?? '',
        isInScope: scope.isInScope,
        description: scope.description ?? '',
      })),
    impacts: program.impacts
      .filter((impact) => isAuthorable(impact.assetType))
      .map((impact) => ({
        rowId: nextRowId('impact'),
        id: impact.id,
        assetType: impact.assetType as AuthorableAssetType,
        severity: impact.severity,
        title: impact.title,
        description: impact.description ?? '',
        ...(impact.templateKey === undefined ? {} : { templateKey: impact.templateKey }),
        enabled: impact.enabled,
      })),
    rewardTiers: program.rewardTiers
      .filter((tier) => isAuthorable(tier.assetType))
      .map((tier) => ({
        rowId: nextRowId('tier'),
        assetType: tier.assetType as AuthorableAssetType,
        severity: tier.severity,
        calculationType: tier.calculationType,
        minReward: tier.minReward ?? '',
        maxReward: tier.maxReward ?? '',
        flatAmount: tier.flatAmount ?? '',
        percentage: tier.percentageBps === undefined ? '' : String(tier.percentageBps / 100),
        maxRewardCap: tier.maxRewardCap ?? '',
        calculationNote: tier.calculationNote ?? '',
      })),
    rules: {
      pocPolicy: program.rules.pocPolicy,
      pocPolicyNote: program.rules.pocPolicyNote ?? '',
      rewardPolicy: program.rules.rewardPolicy ?? '',
      prohibitedActivities: program.rules.prohibitedActivities
        .filter((rule) => rule.source === 'custom')
        .map((rule) => ({ rowId: nextRowId('rule'), body: rule.body })),
      testingRestrictions: program.rules.testingRestrictions ?? '',
      submissionAcknowledgment: program.rules.submissionAcknowledgment ?? '',
      allowCustomImpact: program.rules.allowCustomImpact,
    },
  };
}

/* ── Derived views ─────────────────────────────────────────────────────────────────────────── */

/** Asset types that carry at least one in-scope asset — the set impacts and rewards must cover. */
export function inScopeAssetTypes(draft: ProgramDraft): readonly AuthorableAssetType[] {
  return AUTHORABLE_ASSET_TYPES.filter((assetType) =>
    draft.scopes.some((scope) => scope.assetType === assetType && scope.isInScope),
  );
}

/** Asset types the scope mentions at all, so a tab never disappears while a row still exists. */
export function scopedAssetTypes(draft: ProgramDraft): readonly AuthorableAssetType[] {
  return AUTHORABLE_ASSET_TYPES.filter((assetType) =>
    draft.scopes.some((scope) => scope.assetType === assetType),
  );
}

export function templateImpactsFor(assetType: AuthorableAssetType): readonly ImpactTemplate[] {
  return IMPACT_TEMPLATES.filter((template) => template.assetType === assetType);
}

/**
 * Adds the platform template catalogue for any in-scope asset type that has no impacts yet.
 * Templates are copied into owner-editable rows, so editing the platform list later never changes
 * a program that is already running.
 */
export function seedImpacts(draft: ProgramDraft): readonly ImpactRow[] {
  const seeded: ImpactRow[] = [...draft.impacts];

  for (const assetType of inScopeAssetTypes(draft)) {
    if (seeded.some((impact) => impact.assetType === assetType)) continue;

    for (const template of templateImpactsFor(assetType)) {
      seeded.push({
        rowId: nextRowId('impact'),
        assetType,
        severity: template.severity,
        title: template.title,
        description: template.description,
        templateKey: template.templateKey,
        enabled: true,
      });
    }
  }

  return seeded;
}

/** Gives every in-scope asset type a starting reward row so the owner has a form to fill in. */
export function seedRewardTiers(draft: ProgramDraft): readonly TierRow[] {
  const seeded: TierRow[] = [...draft.rewardTiers];

  for (const assetType of inScopeAssetTypes(draft)) {
    if (seeded.some((tier) => tier.assetType === assetType)) continue;
    seeded.push(createTierRow(assetType, seeded));
  }

  return seeded;
}

/** Picks the first severity that is still free for this asset type, so a new row is never a clash. */
export function createTierRow(
  assetType: AuthorableAssetType,
  existing: readonly TierRow[],
): TierRow {
  const used = new Set(
    existing.filter((tier) => tier.assetType === assetType).map((tier) => tier.severity),
  );
  const severity = SEVERITY_ORDER.find((candidate) => !used.has(candidate)) ?? 'critical';

  return {
    rowId: nextRowId('tier'),
    assetType,
    severity,
    calculationType: 'range',
    minReward: '',
    maxReward: '',
    flatAmount: '',
    percentage: '',
    maxRewardCap: '',
    calculationNote: '',
  };
}

/* ── Formatting ────────────────────────────────────────────────────────────────────────────── */

export function formatUsdc(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} USDC`;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`;
}

export function shortenAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Build the Arc testnet address link used by owner scope previews. */
export function contractExplorerHref(
  address: string,
  explorerBaseUrl = process.env['NEXT_PUBLIC_ARC_EXPLORER_URL'] ?? 'https://testnet.arcscan.app',
): string {
  const base = new URL(explorerBaseUrl);
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/address/${address}`;
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function describeTier(tier: TierRow): string {
  if (tier.calculationType === 'flat') {
    return tier.flatAmount === '' ? 'Flat amount not set' : `Flat ${formatUsdc(tier.flatAmount)}`;
  }
  if (tier.calculationType === 'percentage') {
    const rate = tier.percentage === '' ? '—' : `${tier.percentage}%`;
    const cap =
      tier.maxRewardCap === '' ? 'no cap set' : `capped at ${formatUsdc(tier.maxRewardCap)}`;
    return `${rate} of affected funds, ${cap}`;
  }
  if (tier.minReward === '' || tier.maxReward === '') return 'Range not set';
  return `${formatUsdc(tier.minReward)} – ${formatUsdc(tier.maxReward)}`;
}

/* ── Validation ────────────────────────────────────────────────────────────────────────────── */

export type FieldErrors = Readonly<Record<string, string>>;

/** DOM id for a field key, so the first invalid control can be focused after a failed step. */
export function fieldId(key: string): string {
  return `cp-${key.replace(/[^A-Za-z0-9_-]/g, '-')}`;
}

/**
 * The asset-type tab an error key belongs to, or `null` when the key is not tab-scoped.
 *
 * Group keys spell the asset type out (`impacts.website`), while row keys carry a row id
 * (`rewardTiers.tier-3.maxReward`) that only the draft can resolve. Both tabbed steps route
 * through this one rule so the tab error marker and the failed-submit tab jump can never disagree
 * about which panel a message belongs to.
 */
export function assetTypeForErrorKey(draft: ProgramDraft, key: string): AuthorableAssetType | null {
  const [group, second] = key.split('.');
  if (group === undefined || second === undefined) return null;
  if (isAuthorable(second)) return second;

  const rows: readonly { readonly rowId: string; readonly assetType: AuthorableAssetType }[] =
    group === 'impacts' ? draft.impacts : group === 'rewardTiers' ? draft.rewardTiers : [];

  return rows.find((row) => row.rowId === second)?.assetType ?? null;
}

/**
 * Tab a failed step submit has to open: the one owning the earliest failing key. Radix unmounts
 * the inactive `TabsContent`, so without this the focus jump finds nothing whenever the first
 * failure sits behind a tab the owner is not looking at.
 */
export function firstErrorAssetType(
  draft: ProgramDraft,
  errors: FieldErrors,
): AuthorableAssetType | null {
  for (const key of Object.keys(errors)) {
    const assetType = assetTypeForErrorKey(draft, key);
    if (assetType !== null) return assetType;
  }

  return null;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function suggestSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/['`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isPositiveAmount(value: string): boolean {
  return AMOUNT_PATTERN.test(value) && Number(value) > 0;
}

export function validateOverview(draft: ProgramDraft): FieldErrors {
  const errors: Record<string, string> = {};

  if (draft.name.trim() === '') errors['name'] = 'Enter a program name.';
  else if (draft.name.trim().length > 200) errors['name'] = 'Keep the name within 200 characters.';

  if (!SLUG_PATTERN.test(draft.slug.trim()) || draft.slug.trim().length > 120) {
    errors['slug'] = 'Use lowercase letters, numbers and single hyphens.';
  }

  const summary = draft.shortSummary.trim();
  if (summary === '' || summary.length > 280) {
    errors['shortSummary'] = 'Add a summary within 280 characters.';
  }

  if (!isHttpsUrl(draft.websiteUrl.trim())) errors['websiteUrl'] = 'Enter a valid HTTPS website.';

  if (draft.tags.length === 0) errors['tags'] = 'Add at least one program tag.';
  else if (draft.tags.length > 10) errors['tags'] = 'A program can carry up to 10 tags.';

  const description = draft.description.trim();
  if (description === '' || description.length > 20_000)
    errors['description'] = 'Describe the program.';

  // Key insertion mirrors the on-screen field order — the deadline sits above Resources — because
  // a failed step submit focuses the control behind the first key of this object.
  if (draft.deadline !== '') {
    const parsed = new Date(`${draft.deadline}T23:59:59`);
    if (Number.isNaN(parsed.getTime()) || parsed.getTime() <= Date.now()) {
      errors['deadline'] = 'Choose a valid future date or leave it empty.';
    }
  }

  for (const resource of draft.resources) {
    if (resource.title.trim() === '' || !isHttpsUrl(resource.url.trim())) {
      errors[`resources.${resource.rowId}`] = 'Enter a title and valid HTTPS URL.';
    }
  }

  return errors;
}

/** Validates a single scope row; the dialog stays open while any of these are present. */
export function validateScopeRow(row: ScopeRow): FieldErrors {
  const errors: Record<string, string> = {};

  if (row.assetName.trim() === '') errors['assetName'] = 'Enter an asset name.';
  else if (row.assetName.trim().length > 200) {
    errors['assetName'] = 'Keep the asset name within 200 characters.';
  }

  if (row.assetUrl.trim() !== '' && !isUrl(row.assetUrl.trim())) {
    errors['assetUrl'] = 'Enter a valid URL.';
  }

  if (row.contractAddress.trim() !== '' && !EVM_ADDRESS_PATTERN.test(row.contractAddress.trim())) {
    errors['contractAddress'] = 'Enter a valid EVM contract address.';
  }

  if (row.description.trim().length > 2_000) {
    errors['description'] = 'Keep the description within 2,000 characters.';
  }

  return errors;
}

export function validateScope(draft: ProgramDraft): FieldErrors {
  const errors: Record<string, string> = {};

  if (draft.scopes.length === 0) {
    errors['scopes'] = 'Add at least one scope item.';
    return errors;
  }

  if (draft.scopes.length > 50) {
    errors['scopes'] = 'A program can contain up to 50 scope items.';
    return errors;
  }

  if (!draft.scopes.some((scope) => scope.isInScope)) {
    errors['scopes'] = 'Add at least one asset researchers can assess.';
    return errors;
  }

  for (const scope of draft.scopes) {
    const rowErrors = validateScopeRow(scope);
    const first = Object.values(rowErrors)[0];
    if (first !== undefined) errors[`scopes.${scope.rowId}`] = first;
  }

  return errors;
}

/**
 * Duplicate detection must match `createProgramRequestSchema`, which collapses every run of
 * non-alphanumerics to one space (mirroring the `normalized_title` column). A looser client rule
 * would let a step pass and then fail the whole payload at Review with a generic save error.
 */
export function normalizeImpactTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function validateImpacts(draft: ProgramDraft): FieldErrors {
  const errors: Record<string, string> = {};

  for (const assetType of inScopeAssetTypes(draft)) {
    const forType = draft.impacts.filter((impact) => impact.assetType === assetType);

    if (!forType.some((impact) => impact.enabled)) {
      errors[`impacts.${assetType}`] = 'Add at least one impact for this asset type.';
      continue;
    }

    const seen = new Set<string>();
    for (const impact of forType) {
      if (impact.title.trim() === '') {
        errors[`impacts.${impact.rowId}`] = 'Enter an impact title.';
        continue;
      }

      const normalized = normalizeImpactTitle(impact.title);
      if (seen.has(normalized)) {
        errors[`impacts.${impact.rowId}`] = 'This impact is already listed for this asset type.';
        errors[`impacts.${assetType}`] = 'This impact is already listed for this asset type.';
      }
      seen.add(normalized);
    }
  }

  return errors;
}

/**
 * CP-03V amount rules for one row. Only the fields the selected calculation type owns are judged:
 * the rest are stale client state left by a type switch, and `tierPayload` never sends them, so
 * blocking the step on them would fail a submit the API would have accepted.
 */
function validateTierAmounts(tier: TierRow, errors: Record<string, string>): void {
  if (tier.calculationType === 'range') {
    // §3 calls the minimum a non-negative monetary amount, so an explicit `0` is legitimate and
    // the check is the `monetaryAmountSchema` pattern rather than a positivity test.
    if (!AMOUNT_PATTERN.test(tier.minReward)) {
      errors[`rewardTiers.${tier.rowId}.minReward`] = 'Enter a valid USDC amount.';
    }
    if (!isPositiveAmount(tier.maxReward)) {
      errors[`rewardTiers.${tier.rowId}.maxReward`] = 'Enter a valid USDC amount.';
    } else if (
      AMOUNT_PATTERN.test(tier.minReward) &&
      Number(tier.maxReward) < Number(tier.minReward)
    ) {
      errors[`rewardTiers.${tier.rowId}.maxReward`] =
        'Maximum reward must not be below minimum reward.';
    }
    return;
  }

  if (tier.calculationType === 'flat') {
    if (!isPositiveAmount(tier.flatAmount)) {
      errors[`rewardTiers.${tier.rowId}.flatAmount`] = 'Enter a valid USDC amount.';
    }
    return;
  }

  const percentage = Number(tier.percentage);
  // The API stores whole basis points (min 1), so a rate that rounds below 0.01% must fail
  // here with a field error instead of failing the whole payload at Review.
  if (
    tier.percentage === '' ||
    !Number.isFinite(percentage) ||
    percentage <= 0 ||
    percentage > 100 ||
    Math.round(percentage * 100) < 1
  ) {
    errors[`rewardTiers.${tier.rowId}.percentage`] =
      'Enter a percentage greater than 0% and no more than 100%.';
  }
  // The reviewer supplies the verified basis at approval and the server computes
  // `min(basis × bps / 10000, cap)`, so the cap is a real payout ceiling, not guidance.
  if (!isPositiveAmount(tier.maxRewardCap)) {
    errors[`rewardTiers.${tier.rowId}.maxRewardCap`] =
      'Enter the maximum USDC reward for this calculation.';
  }
}

export function validateRewards(draft: ProgramDraft): FieldErrors {
  const errors: Record<string, string> = {};

  // CP-03V "Không có tier". This does not return early: an owner who deleted every row still
  // needs the per-asset-type key, because that is what paints the tab marker and gives the failed
  // submit a target inside the panel.
  if (draft.rewardTiers.length === 0) {
    errors['rewardTiers'] = 'Add at least one reward tier.';
  }

  for (const assetType of inScopeAssetTypes(draft)) {
    const forType = draft.rewardTiers.filter((tier) => tier.assetType === assetType);

    if (forType.length === 0) {
      errors[`rewardTiers.${assetType}`] = 'Add at least one reward tier for this asset type.';
      continue;
    }

    /*
     * One pass in row order, so the error keys come out in the order the panel draws them and a
     * failed submit focuses the first invalid control on screen.
     *
     * Uniqueness is `(asset type, severity)` and never severity alone — `seen` is scoped to this
     * asset type, so the same severity priced on both tabs is the normal case, not a clash.
     * Rows belonging to an asset type that is no longer in scope are skipped entirely: `tierPayload`
     * drops them, and an error on a row with no tab would strand the wizard.
     */
    const seen = new Set<Severity>();
    for (const tier of forType) {
      if (seen.has(tier.severity)) {
        errors[`rewardTiers.${tier.rowId}.severity`] =
          'Each severity can only be used once per asset type.';
        errors[`rewardTiers.${assetType}`] = 'Each severity can only be used once per asset type.';
      }
      seen.add(tier.severity);

      validateTierAmounts(tier, errors);
    }
  }

  return errors;
}

/**
 * CP-03RV. Keys are inserted in on-screen order — policy note, reward policy, prohibited rows,
 * testing restrictions, acknowledgment — because a failed step submit focuses the control behind
 * the first key of this object.
 *
 * Every length rule is judged here and the optional fields carry no `maxLength`: a hard cap on the
 * control silently truncates the paste and, worse, makes the only branch that can produce
 * `Keep the acknowledgment within 1,000 characters.` unreachable, so a message CP-03RV requires
 * could never be shown. `rewardPolicy` keeps its cap because its message also covers the empty
 * case, which is the branch the flow document actually names.
 */
export function validateRules(draft: ProgramDraft): FieldErrors {
  const errors: Record<string, string> = {};

  if (draft.rules.pocPolicyNote.trim().length > 2_000) {
    errors['rules.pocPolicyNote'] = 'Keep the policy note within 2,000 characters.';
  }

  const policy = draft.rules.rewardPolicy.trim();
  if (policy === '' || policy.length > 20_000) {
    errors['rules.rewardPolicy'] = 'Describe reward eligibility and exclusions.';
  }

  /*
   * Only owner rows are judged. The platform baseline is never copied into the draft — it is
   * rendered straight from `PLATFORM_PROHIBITED_ACTIVITIES` and re-snapshotted server-side — so a
   * locked default can neither be blanked into an error nor consume one of the 20 custom slots.
   */
  for (const rule of draft.rules.prohibitedActivities) {
    if (rule.body.trim() === '') {
      errors[`rules.prohibited.${rule.rowId}`] = 'Enter a rule or remove this row.';
    }
  }

  if (draft.rules.testingRestrictions.trim().length > 10_000) {
    errors['rules.testingRestrictions'] = 'Keep testing restrictions within 10,000 characters.';
  }

  if (draft.rules.submissionAcknowledgment.trim().length > 1_000) {
    errors['rules.submissionAcknowledgment'] = 'Keep the acknowledgment within 1,000 characters.';
  }

  return errors;
}

/* ── Save errors (CP-07) ───────────────────────────────────────────────────────────────────── */

/**
 * Extra sentence CP-07 may render *beside* — never instead of — the error copy the flow document
 * fixes verbatim.
 *
 * The program write endpoints answer a rejected payload with a stable `error.code` (CP-02), and the
 * mandated sentence cannot say which of the rules fired, so an owner staring at "check every field"
 * has six steps to re-read. Only codes a create or an update of a program can actually produce are
 * listed; every other code keeps the generic surface on its own.
 */
const OWNER_ROLE_HINT =
  'This account no longer has Program owner access, so the draft cannot be created.';

/*
 * A `Map`, not an object literal: the key is a string the server chose, and an object literal would
 * answer `constructor` or `toString` with something off `Object.prototype`.
 */
const SAVE_ERROR_HINTS: ReadonlyMap<string, string> = new Map([
  [
    'deadline_not_in_future',
    'The deadline is no longer in the future. Edit Program details and choose a later date, or clear it.',
  ],
  [
    'asset_type_not_enabled',
    'An asset type in the payload is not open to new programs. Edit Scope and keep every asset on Smart contract or Website.',
  ],
  [
    'reward_tier_duplicate',
    'Two reward tiers share an asset type and severity. Edit Reward tiers and leave one row per severity.',
  ],
  [
    'impact_title_duplicate',
    'Two impacts of the same asset type share a title. Edit Impacts and rename or remove the duplicate.',
  ],
  [
    'impact_asset_type_not_in_scope',
    'An impact belongs to an asset type with no scope item. Edit Scope to add the asset, or Impacts to drop the impact.',
  ],
  [
    'reward_tier_asset_type_not_in_scope',
    'A reward tier belongs to an asset type with no scope item. Edit Scope to add the asset, or Reward tiers to drop the tier.',
  ],
  [
    'impact_coverage_missing',
    'Every in-scope asset type needs at least one enabled impact. Edit Impacts.',
  ],
  [
    'reward_tier_coverage_missing',
    'Every in-scope asset type needs at least one reward tier. Edit Reward tiers.',
  ],
  [
    'database_unique_violation',
    'A value that has to be unique is already taken, almost always the URL slug. Edit Program details and change it.',
  ],
  [
    'program_not_accessible',
    'This program can no longer be written from this account. Refresh the page before retrying.',
  ],
  // The roles guard answers a non-owner with a bare 403, so the generic code and the reserved
  // role-specific one have to resolve to the same hint.
  ['forbidden', OWNER_ROLE_HINT],
  ['owner_role_required', OWNER_ROLE_HINT],
]);

export function saveErrorHint(code: string): string | null {
  return SAVE_ERROR_HINTS.get(code) ?? null;
}

/* ── API payloads ──────────────────────────────────────────────────────────────────────────── */

function optionalText(value: string): Record<string, string> {
  const trimmed = value.trim();
  return trimmed === '' ? {} : { value: trimmed };
}

function withOptional(key: string, value: string): Record<string, string> {
  const entry = optionalText(value);
  return entry['value'] === undefined ? {} : { [key]: entry['value'] };
}

function scopePayload(draft: ProgramDraft): unknown[] {
  return draft.scopes.map((scope, index) => ({
    ...(scope.id === undefined ? {} : { id: scope.id }),
    assetType: scope.assetType,
    assetName: scope.assetName.trim(),
    ...withOptional('assetUrl', scope.assetUrl),
    ...withOptional('contractAddress', scope.contractAddress),
    isInScope: scope.isInScope,
    ...withOptional('description', scope.description),
    sortOrder: index,
  }));
}

function impactPayload(draft: ProgramDraft): unknown[] {
  const live = new Set(inScopeAssetTypes(draft));

  return draft.impacts
    .filter((impact) => live.has(impact.assetType))
    .map((impact, index) => ({
      ...(impact.id === undefined ? {} : { id: impact.id }),
      assetType: impact.assetType,
      severity: impact.severity,
      title: impact.title.trim(),
      ...withOptional('description', impact.description),
      source: impact.templateKey === undefined ? 'custom' : 'template',
      ...(impact.templateKey === undefined ? {} : { templateKey: impact.templateKey }),
      enabled: impact.enabled,
      sortOrder: index,
    }));
}

function tierPayload(draft: ProgramDraft): unknown[] {
  const live = new Set(inScopeAssetTypes(draft));

  return draft.rewardTiers
    .filter((tier) => live.has(tier.assetType))
    .map((tier) => ({
      assetType: tier.assetType,
      severity: tier.severity,
      calculationType: tier.calculationType,
      ...(tier.calculationType === 'range'
        ? { minReward: tier.minReward.trim(), maxReward: tier.maxReward.trim() }
        : {}),
      ...(tier.calculationType === 'flat' ? { flatAmount: tier.flatAmount.trim() } : {}),
      ...(tier.calculationType === 'percentage'
        ? {
            percentageBps: Math.round(Number(tier.percentage) * 100),
            maxRewardCap: tier.maxRewardCap.trim(),
          }
        : {}),
      ...withOptional('calculationNote', tier.calculationNote),
    }));
}

function rulesPayload(draft: ProgramDraft): unknown {
  return {
    pocPolicy: draft.rules.pocPolicy,
    ...withOptional('pocPolicyNote', draft.rules.pocPolicyNote),
    rewardPolicy: draft.rules.rewardPolicy.trim(),
    prohibitedActivities: draft.rules.prohibitedActivities
      .map((rule) => rule.body.trim())
      .filter((body) => body !== ''),
    ...withOptional('testingRestrictions', draft.rules.testingRestrictions),
    ...withOptional('submissionAcknowledgment', draft.rules.submissionAcknowledgment),
    allowCustomImpact: draft.rules.allowCustomImpact,
  };
}

function deadlinePayload(draft: ProgramDraft): Record<string, string> {
  if (draft.deadline === '') return {};
  const parsed = new Date(`${draft.deadline}T23:59:59`);
  return Number.isNaN(parsed.getTime()) ? {} : { deadline: parsed.toISOString() };
}

/** Shape for `createProgramRequestSchema`. Parsed by the caller before it reaches the network. */
export function buildCreatePayload(draft: ProgramDraft): unknown {
  return {
    name: draft.name.trim(),
    slug: draft.slug.trim(),
    shortSummary: draft.shortSummary.trim(),
    description: draft.description.trim(),
    websiteUrl: draft.websiteUrl.trim(),
    tags: draft.tags,
    ...deadlinePayload(draft),
    resources: draft.resources.map((resource, index) => ({
      resourceType: resource.resourceType,
      title: resource.title.trim(),
      url: resource.url.trim(),
      sortOrder: index,
    })),
    scopes: scopePayload(draft),
    impacts: impactPayload(draft),
    rewardTiers: tierPayload(draft),
    rules: rulesPayload(draft),
  };
}

/** Shape for `updateProgramRequestSchema`. The slug is immutable once the program exists. */
export function buildUpdatePayload(draft: ProgramDraft, expectedUpdatedAt: string): unknown {
  const deadline = deadlinePayload(draft);

  return {
    name: draft.name.trim(),
    shortSummary: draft.shortSummary.trim(),
    description: draft.description.trim(),
    websiteUrl: draft.websiteUrl.trim(),
    tags: draft.tags,
    deadline: deadline['deadline'] ?? null,
    resources: draft.resources.map((resource, index) => ({
      resourceType: resource.resourceType,
      title: resource.title.trim(),
      url: resource.url.trim(),
      sortOrder: index,
    })),
    scopes: scopePayload(draft),
    impacts: impactPayload(draft),
    rewardTiers: tierPayload(draft),
    rules: rulesPayload(draft),
    expectedUpdatedAt,
  };
}
