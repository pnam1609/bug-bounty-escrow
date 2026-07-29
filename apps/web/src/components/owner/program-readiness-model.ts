import {
  parseUsdcBaseUnits,
  type AuthorableAssetType,
  type Program,
} from '@bug-bounty-escrow/shared';

export type ProgramReadinessId =
  | 'program-details'
  | 'scope'
  | 'impact-catalog'
  | 'reward-tiers'
  | 'program-rules'
  | 'escrow-contract'
  | 'funding'
  | 'publishing';

export interface ProgramReadinessItem {
  readonly complete: boolean;
  readonly detail: string;
  readonly id: ProgramReadinessId;
  readonly status: string;
  readonly title: string;
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '';
}

function formatUsdc(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} USDC`;
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })} USDC`;
}

function shortenAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function authorableInScopeTypes(program: Program): readonly AuthorableAssetType[] {
  const types = new Set<AuthorableAssetType>();

  for (const scope of program.scopes) {
    if (scope.archived || !scope.isInScope) continue;
    if (scope.assetType === 'smart_contract' || scope.assetType === 'website') {
      types.add(scope.assetType);
    }
  }

  return [...types];
}

/**
 * Derives CP-06 readiness from the saved server representation.
 *
 * Create and update endpoints enforce these same coverage invariants. Keeping the derivation here
 * (rather than hard-coding five "Complete" labels in the view) prevents the icon and status text
 * from contradicting one another if an older or partially migrated draft is opened.
 */
export function buildProgramReadiness(program: Program): readonly ProgramReadinessItem[] {
  const activeScopes = program.scopes.filter((scope) => !scope.archived);
  const inScopeTypes = authorableInScopeTypes(program);
  const enabledImpacts = program.impacts.filter((impact) => impact.enabled);

  const detailsComplete =
    hasText(program.name) &&
    hasText(program.slug) &&
    hasText(program.shortSummary) &&
    hasText(program.description) &&
    hasText(program.websiteUrl) &&
    program.deadline !== undefined &&
    Number.isFinite(Date.parse(program.deadline)) &&
    Date.parse(program.deadline) > Date.now() &&
    program.tags.length > 0;
  const scopeComplete = inScopeTypes.length > 0;
  const impactsComplete =
    scopeComplete &&
    inScopeTypes.every((assetType) =>
      enabledImpacts.some((impact) => impact.assetType === assetType),
    );
  const rewardsComplete =
    scopeComplete &&
    inScopeTypes.every((assetType) =>
      program.rewardTiers.some((tier) => tier.assetType === assetType),
    );
  const rulesComplete = hasText(program.rules.rewardPolicy);
  const authoringComplete =
    detailsComplete && scopeComplete && impactsComplete && rewardsComplete && rulesComplete;

  const contractAddress = program.contractAddress?.trim() ?? '';
  const deployed = contractAddress !== '';
  const availableBaseUnits = parseUsdcBaseUnits(program.remainingPool);
  const maxBountyBaseUnits = parseUsdcBaseUnits(program.maxBounty);
  const funded =
    availableBaseUnits !== undefined &&
    maxBountyBaseUnits !== undefined &&
    maxBountyBaseUnits > 0n &&
    availableBaseUnits >= maxBountyBaseUnits;
  const published = program.publicStatus !== null && program.publishedAt !== undefined;
  const publishingReady = authoringComplete && deployed && funded;

  return [
    {
      complete: detailsComplete,
      detail: 'Name, slug, description and deadline',
      id: 'program-details',
      status: detailsComplete ? 'Complete' : 'Incomplete',
      title: 'Program details',
    },
    {
      complete: scopeComplete,
      detail: `${activeScopes.length} configured ${activeScopes.length === 1 ? 'asset' : 'assets'}`,
      id: 'scope',
      status: scopeComplete ? 'Complete' : 'Incomplete',
      title: 'Scope',
    },
    {
      complete: impactsComplete,
      detail: `${enabledImpacts.length} enabled ${enabledImpacts.length === 1 ? 'impact' : 'impacts'}`,
      id: 'impact-catalog',
      status: impactsComplete ? 'Complete' : 'Incomplete',
      title: 'Impact catalog',
    },
    {
      complete: rewardsComplete,
      detail: `${program.rewardTiers.length} USDC ${program.rewardTiers.length === 1 ? 'tier' : 'tiers'}`,
      id: 'reward-tiers',
      status: rewardsComplete ? 'Complete' : 'Incomplete',
      title: 'Reward tiers',
    },
    {
      complete: rulesComplete,
      detail: `Proof of concept ${program.rules.pocPolicy}`,
      id: 'program-rules',
      status: rulesComplete ? 'Complete' : 'Incomplete',
      title: 'Program rules',
    },
    {
      complete: deployed,
      detail: deployed
        ? shortenAddress(contractAddress)
        : 'Deploy a program-specific escrow contract',
      id: 'escrow-contract',
      status: deployed ? 'Complete' : 'Not deployed',
      title: 'Escrow contract',
    },
    {
      complete: funded,
      detail: funded
        ? 'Available escrow covers the maximum bounty'
        : `Available escrow must cover the ${formatUsdc(program.maxBounty)} maximum bounty`,
      id: 'funding',
      status: funded ? 'Complete' : `${formatUsdc(program.remainingPool)} available`,
      title: 'Funding',
    },
    {
      complete: published,
      detail: published
        ? 'The program is published'
        : 'Publishing is a separate action after escrow funding',
      id: 'publishing',
      status: published ? 'Published' : publishingReady ? 'Ready' : 'Not ready',
      title: 'Publishing',
    },
  ];
}
