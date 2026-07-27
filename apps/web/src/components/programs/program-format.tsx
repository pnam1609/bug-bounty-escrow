import type { AssetType, Program, ProgramSummary, Severity } from '@bug-bounty-escrow/shared';

/*
 * Presentation helpers shared by the desktop bounty table, the mobile vertical rows and the
 * program detail page. Formatting lives here and nowhere else so a figure can never read one way
 * in the table and another way on the detail screen.
 *
 * Two rules from docs/flow/bounty-table-program-list-for-figma.md §7 drive the shape of every
 * money helper:
 *   - a monetary value always carries the `USDC` unit, and
 *   - the compact primary line ("250K USDC") is always paired with a full accessible label
 *     ("250,000 USDC maximum bounty"), never a tooltip on its own.
 */

const COMPACT_USDC = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

const FULL_USDC = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

const ABSOLUTE_DATE = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/** A monetary cell: what is drawn, and what a screen reader is told instead. */
export interface MoneyDisplay {
  readonly text: string;
  readonly label: string;
}

function toAmount(value: string): number {
  const amount = Number(value);

  return Number.isFinite(amount) ? amount : 0;
}

export function formatUsdcCompact(value: string): string {
  return `${COMPACT_USDC.format(toAmount(value))} USDC`;
}

export function formatUsdcFull(value: string): string {
  return `${FULL_USDC.format(toAmount(value))} USDC`;
}

/**
 * Compact on the primary line, exact in the accessible label. `role` completes the sentence a
 * screen reader hears, e.g. "250,000 USDC maximum bounty".
 */
export function formatMoney(value: string, role: string): MoneyDisplay {
  return { text: formatUsdcCompact(value), label: `${formatUsdcFull(value)} ${role}` };
}

/**
 * `null` means the owner keeps the settled figure private. The word is rendered — never `0`,
 * never a dash, never a blurred or faked number (§7).
 */
export function formatTotalPaid(value: string | null): MoneyDisplay {
  if (value === null) {
    return { text: 'Private', label: 'Total paid is private' };
  }

  return formatMoney(value, 'paid out so far');
}

/**
 * A reward tier prices its severity as a fixed amount (`flat`), a `min – max` band (`range`) or a
 * percentage of the verified affected funds with a hard cap (`percentage`). Each calculation type
 * keeps its own shape and every amount stays in `USDC` — never converted to USD (submit-bug flow
 * §8 PG-DETAIL).
 */
export function formatRewardTier(tier: Program['rewardTiers'][number]): string {
  if (tier.calculationType === 'flat') {
    return formatUsdcFull(tier.flatAmount ?? '0');
  }

  if (tier.calculationType === 'percentage') {
    const percentage = (tier.percentageBps ?? 0) / 100;

    return `${percentage}% of the verified affected funds, capped at ${formatUsdcFull(
      tier.maxRewardCap ?? '0',
    )}`;
  }

  return `${formatUsdcFull(tier.minReward ?? '0')} – ${formatUsdcFull(tier.maxReward ?? '0')}`;
}

export function formatAbsoluteDate(iso: string): string {
  const date = new Date(iso);

  return Number.isNaN(date.getTime()) ? 'Unknown date' : ABSOLUTE_DATE.format(date);
}

/** Deadline cell: relative label, absolute date underneath, or `Ongoing` when there is none. */
export interface DeadlineDisplay {
  readonly primary: string;
  readonly secondary: string;
  readonly label: string;
  /** Ended programs are dimmed rather than coloured; `Ongoing` is not a health signal (§7). */
  readonly ended: boolean;
}

function daysUntil(iso: string, now: number): number {
  return Math.ceil((new Date(iso).getTime() - now) / MILLISECONDS_PER_DAY);
}

export function describeDeadline(
  program: Pick<ProgramSummary, 'deadline' | 'publicStatus'>,
  now: number = Date.now(),
): DeadlineDisplay {
  const { deadline } = program;
  const hasEnded = program.publicStatus === 'ended';

  if (deadline === undefined) {
    if (hasEnded) {
      return {
        primary: 'Ended',
        secondary: 'No fixed deadline',
        label: 'This program has ended',
        ended: true,
      };
    }

    return {
      primary: 'Ongoing',
      secondary: 'No fixed deadline',
      label: 'Ongoing, no fixed deadline',
      ended: false,
    };
  }

  const absolute = formatAbsoluteDate(deadline);
  const remaining = daysUntil(deadline, now);

  if (hasEnded || remaining < 0) {
    return {
      primary: 'Ended',
      secondary: absolute,
      label: `Ended on ${absolute}`,
      ended: true,
    };
  }

  const relative =
    remaining === 0 ? 'Closes today' : `${remaining} day${remaining === 1 ? '' : 's'}`;

  return {
    primary: relative,
    secondary: absolute,
    label:
      remaining === 0 ? `Closes today, ${absolute}` : `Closes in ${relative} on ${absolute}`,
    ended: false,
  };
}

export const ASSET_TYPE_LABELS: Readonly<Record<AssetType, string>> = Object.freeze({
  smart_contract: 'Smart contract',
  website: 'Website',
  api: 'API',
  mobile: 'Mobile',
});

/** Plural form used for the asset-type sub-tabs on the program detail screen. */
export const ASSET_TYPE_GROUP_LABELS: Readonly<Record<AssetType, string>> = Object.freeze({
  smart_contract: 'Smart contracts',
  website: 'Websites',
  api: 'APIs',
  mobile: 'Mobile apps',
});

/**
 * Owner-configured resource links carry a `resourceType` on the wire; the detail page's
 * `Resources` section renders it so a reader can tell documentation from a repository or an
 * audit report before leaving the site (submit-bug flow §8 PG-DETAIL).
 */
export const RESOURCE_TYPE_LABELS: Readonly<
  Record<Program['resources'][number]['resourceType'], string>
> = Object.freeze({
  documentation: 'Documentation',
  repository: 'Repository',
  audit: 'Audit report',
  website: 'Website',
  other: 'Official link',
});

export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = Object.freeze({
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Informational',
});

/** First letter of the program name, for the monogram tile when there is no logo. */
export function programMonogram(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

/** Whole days once the figure is coarse enough for one; hours below two days. */
export function formatResolutionTime(seconds: number): string {
  const hours = Math.round(seconds / 3600);

  if (hours < 48) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  const days = Math.round(hours / 24);

  return `${days} day${days === 1 ? '' : 's'}`;
}
