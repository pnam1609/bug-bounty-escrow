'use client';

import type { AssetType, ProgramListQuery, Severity } from '@bug-bounty-escrow/shared';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

import { ASSET_TYPE_LABELS, SEVERITY_LABELS } from './program-format';

/*
 * Filter state for the public bounty table.
 *
 * The state lives in the URL and nowhere else, so reload, share-a-link and Back/Forward all
 * restore the same table (§6). Every value is re-validated on the way out of the URL: an unknown
 * or hand-edited query token falls back to the default instead of crashing or reaching the API.
 *
 * Values are only ever put on the wire through `URLSearchParams`, never by string concatenation,
 * so a search term containing `&`, `#` or `%` is escaped exactly once.
 */

export type ProgramSort = ProgramListQuery['sort'];
export type ProgramSortDirection = NonNullable<ProgramListQuery['sortDirection']>;
export type PublicProgramStatus = NonNullable<ProgramListQuery['status']>[number];
export type ClosingFilter = NonNullable<ProgramListQuery['closing']>;

/** Public lifecycle. Both are selected by default and active programs are ordered first. */
export const STATUS_VALUES = Object.freeze(['active', 'ended'] as const);
export const ASSET_TYPE_VALUES = Object.freeze([
  'smart_contract',
  'website',
  'api',
  'mobile',
] as const);
export const SEVERITY_VALUES = Object.freeze([
  'critical',
  'high',
  'medium',
  'low',
  'informational',
] as const);
export const CLOSING_VALUES = Object.freeze(['7d', '30d', 'ongoing'] as const);
export const REWARD_VALUES = Object.freeze(['10000', '50000', '100000'] as const);

export const SORT_VALUES = Object.freeze([
  'newest',
  'deadline',
  'name',
  'maxBounty',
  'totalPaid',
] as const);

/** The API caps `search` at 120 characters; the field refuses to hold more than that. */
export const SEARCH_MAX_LENGTH = 120;

/** Web page size. Six rows fill the first screen and the rest arrive by infinite scroll. */
export const PROGRAM_PAGE_SIZE = 12;

export interface FilterOption<TValue extends string> {
  readonly value: TValue;
  readonly label: string;
}

export const STATUS_OPTIONS: readonly FilterOption<PublicProgramStatus>[] = Object.freeze([
  { value: 'active', label: 'Active' },
  { value: 'ended', label: 'Ended' },
]);

/**
 * The clean URL omits `status`, while the control must still present Active and Ended as checked.
 * Keeping this translation at the view boundary avoids serialising a fake "active only" default.
 */
export function statusSelectionForControls(
  status: readonly PublicProgramStatus[],
): readonly PublicProgramStatus[] {
  return status.length === 0 ? STATUS_VALUES : status;
}

export const ASSET_TYPE_OPTIONS: readonly FilterOption<AssetType>[] = Object.freeze(
  ASSET_TYPE_VALUES.map((value) => ({ value, label: ASSET_TYPE_LABELS[value] })),
);

export const SEVERITY_OPTIONS: readonly FilterOption<Severity>[] = Object.freeze(
  SEVERITY_VALUES.map((value) => ({ value, label: SEVERITY_LABELS[value] })),
);

/**
 * Single-choice groups. The "no preference" row is not in the list: the control renders it from
 * `*_ANY_LABEL`, so `null` stays the only representation of "unset" anywhere in the state.
 */
export const REWARD_ANY_LABEL = 'Any reward';
export const REWARD_OPTIONS: readonly FilterOption<string>[] = Object.freeze([
  { value: '10000', label: '10K+ USDC' },
  { value: '50000', label: '50K+ USDC' },
  { value: '100000', label: '100K+ USDC' },
]);

export const CLOSING_ANY_LABEL = 'Any deadline';
export const CLOSING_OPTIONS: readonly FilterOption<string>[] = Object.freeze([
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'ongoing', label: 'Ongoing' },
]);

export interface ProgramFilterState {
  readonly search: string;
  readonly sort: ProgramSort;
  /** `null` while the default ordering is in force, so no column claims `aria-sort`. */
  readonly sortDirection: ProgramSortDirection | null;
  /** Empty means "both", which is the default the API applies when `status` is omitted. */
  readonly status: readonly PublicProgramStatus[];
  readonly assetType: readonly AssetType[];
  readonly severity: readonly Severity[];
  readonly minMaxReward: string | null;
  readonly closing: ClosingFilter | null;
  readonly funded: boolean;
}

export const EMPTY_FILTERS: ProgramFilterState = Object.freeze({
  search: '',
  sort: 'newest',
  sortDirection: null,
  status: Object.freeze([]),
  assetType: Object.freeze([]),
  severity: Object.freeze([]),
  minMaxReward: null,
  closing: null,
  funded: false,
});

interface ReadonlyParams {
  get(name: string): string | null;
}

function parseList<TValue extends string>(
  raw: string | null,
  allowed: readonly TValue[],
): readonly TValue[] {
  if (raw === null) {
    return [];
  }

  const allowedValues = new Set<string>(allowed);
  const chosen = new Set<string>();

  for (const entry of raw.split(',')) {
    const token = entry.trim();

    if (allowedValues.has(token)) {
      chosen.add(token);
    }
  }

  // Filtering the canonical list keeps a stable order regardless of how the URL was written.
  return allowed.filter((value) => chosen.has(value));
}

function parseSingle<TValue extends string>(
  raw: string | null,
  allowed: readonly TValue[],
): TValue | null {
  if (raw === null) {
    return null;
  }

  const token = raw.trim();

  return allowed.find((value) => value === token) ?? null;
}

export function readProgramFilters(params: ReadonlyParams): ProgramFilterState {
  const sort = parseSingle(params.get('sort'), SORT_VALUES) ?? 'newest';
  const rawDirection = parseSingle(params.get('sortDirection'), ['asc', 'desc'] as const);

  return {
    search: (params.get('search') ?? '').slice(0, SEARCH_MAX_LENGTH),
    sort,
    // A direction without an explicit column would silently reorder the default view, so the two
    // only ever travel together.
    sortDirection: sort === 'newest' ? null : (rawDirection ?? 'asc'),
    status: parseList(params.get('status'), STATUS_VALUES),
    assetType: parseList(params.get('assetType'), ASSET_TYPE_VALUES),
    severity: parseList(params.get('severity'), SEVERITY_VALUES),
    minMaxReward: parseSingle(params.get('minMaxReward'), REWARD_VALUES),
    closing: parseSingle(params.get('closing'), CLOSING_VALUES),
    funded: params.get('funded') === 'true',
  };
}

/** The query string the browser shows. Defaults are omitted so a clean view has a clean URL. */
export function toUrlSearchParams(filters: ProgramFilterState): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search !== '') {
    params.set('search', filters.search);
  }
  if (filters.sort !== 'newest') {
    params.set('sort', filters.sort);
    params.set('sortDirection', filters.sortDirection ?? 'asc');
  }
  if (filters.status.length > 0 && filters.status.length < STATUS_VALUES.length) {
    params.set('status', filters.status.join(','));
  }
  if (filters.assetType.length > 0) {
    params.set('assetType', filters.assetType.join(','));
  }
  if (filters.severity.length > 0) {
    params.set('severity', filters.severity.join(','));
  }
  if (filters.minMaxReward !== null) {
    params.set('minMaxReward', filters.minMaxReward);
  }
  if (filters.closing !== null) {
    params.set('closing', filters.closing);
  }
  if (filters.funded) {
    params.set('funded', 'true');
  }

  return params;
}

/**
 * The request the API sees. `programListQuerySchema` is strict, so only keys it declares may be
 * sent — an unknown key would be rejected with a 400 rather than ignored.
 */
export function toApiSearchParams(filters: ProgramFilterState, page: number): URLSearchParams {
  const params = toUrlSearchParams(filters);

  params.set('page', String(page));
  params.set('limit', String(PROGRAM_PAGE_SIZE));

  return params;
}

/**
 * Stable, serialisable identity for the query cache. Reflecting exactly the values that reach the
 * API means changing any filter or the sort produces a new key, which is what discards the cached
 * pages and restarts the list at page 1 (§6).
 */
export function toQueryKeyFilters(filters: ProgramFilterState): Record<string, unknown> {
  return {
    search: filters.search,
    sort: filters.sort,
    sortDirection: filters.sortDirection,
    status: filters.status.join(','),
    assetType: filters.assetType.join(','),
    severity: filters.severity.join(','),
    minMaxReward: filters.minMaxReward,
    closing: filters.closing,
    funded: filters.funded,
    limit: PROGRAM_PAGE_SIZE,
  };
}

/**
 * Column headers always start ascending, then toggle while the same header stays active. Switching
 * columns resets to ascending so the URL and the table's `aria-sort` never disagree.
 */
export function toggleProgramSort(
  filters: ProgramFilterState,
  column: ProgramSort,
): ProgramFilterState {
  return {
    ...filters,
    sort: column,
    sortDirection: filters.sort === column && filters.sortDirection === 'asc' ? 'desc' : 'asc',
  };
}

/**
 * Filters the user actively applied, excluding the default status selection. `Clear all` only
 * appears when this is above zero (§6).
 */
export function countAppliedFilters(filters: ProgramFilterState): number {
  const statusApplied =
    filters.status.length > 0 && filters.status.length < STATUS_VALUES.length ? 1 : 0;

  return (
    statusApplied +
    filters.assetType.length +
    filters.severity.length +
    (filters.minMaxReward === null ? 0 : 1) +
    (filters.closing === null ? 0 : 1) +
    (filters.funded ? 1 : 0) +
    (filters.search === '' ? 0 : 1)
  );
}

/** Count shown on the mobile `Filters` trigger; search has its own visible control. */
export function countAdvancedFilters(filters: ProgramFilterState): number {
  return countAppliedFilters(filters) - (filters.search === '' ? 0 : 1);
}

/** Advanced filters only — used to tell "no programs yet" apart from "nothing matches". */
export function hasNarrowingFilters(filters: ProgramFilterState): boolean {
  return countAppliedFilters(filters) > 0;
}

export interface ProgramFiltersController {
  readonly filters: ProgramFilterState;
  /** Adds a history entry so Back and Forward step through filter changes. */
  readonly apply: (next: ProgramFilterState) => void;
  /** Replaces the entry — used while typing, so one search does not fill the history. */
  readonly applyQuietly: (next: ProgramFilterState) => void;
  readonly clearAll: () => void;
}

export function useProgramFilters(): ProgramFiltersController {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const filters = useMemo(() => readProgramFilters(searchParams), [searchParams]);

  const navigate = useCallback(
    (next: ProgramFilterState, mode: 'push' | 'replace') => {
      const query = toUrlSearchParams(next).toString();
      const href = query === '' ? pathname : `${pathname}?${query}`;

      // `scroll: false` keeps the reading position when a chip is removed mid-list.
      if (mode === 'push') {
        router.push(href, { scroll: false });
        return;
      }

      router.replace(href, { scroll: false });
    },
    [pathname, router],
  );

  const apply = useCallback(
    (next: ProgramFilterState) => {
      navigate(next, 'push');
    },
    [navigate],
  );

  const applyQuietly = useCallback(
    (next: ProgramFilterState) => {
      navigate(next, 'replace');
    },
    [navigate],
  );

  const clearAll = useCallback(() => {
    // The column sort is a table setting rather than a filter, so `Clear all` leaves it alone.
    navigate(
      { ...EMPTY_FILTERS, sort: filters.sort, sortDirection: filters.sortDirection },
      'push',
    );
  }, [filters.sort, filters.sortDirection, navigate]);

  return { filters, apply, applyQuietly, clearAll };
}

/** One removable chip in the applied-filter row. */
export interface AppliedFilterChip {
  readonly id: string;
  readonly label: string;
  readonly remove: (filters: ProgramFilterState) => ProgramFilterState;
}

export function describeAppliedFilters(filters: ProgramFilterState): readonly AppliedFilterChip[] {
  const chips: AppliedFilterChip[] = [];

  if (filters.search !== '') {
    chips.push({
      id: 'search',
      label: `Search: ${filters.search}`,
      remove: (current) => ({ ...current, search: '' }),
    });
  }

  if (filters.status.length > 0 && filters.status.length < STATUS_VALUES.length) {
    for (const status of filters.status) {
      chips.push({
        id: `status:${status}`,
        label: `Status: ${status === 'active' ? 'Active' : 'Ended'}`,
        remove: (current) => ({
          ...current,
          status: current.status.filter((value) => value !== status),
        }),
      });
    }
  }

  for (const assetType of filters.assetType) {
    chips.push({
      id: `assetType:${assetType}`,
      label: ASSET_TYPE_LABELS[assetType],
      remove: (current) => ({
        ...current,
        assetType: current.assetType.filter((value) => value !== assetType),
      }),
    });
  }

  for (const severity of filters.severity) {
    chips.push({
      id: `severity:${severity}`,
      label: SEVERITY_LABELS[severity],
      remove: (current) => ({
        ...current,
        severity: current.severity.filter((value) => value !== severity),
      }),
    });
  }

  if (filters.minMaxReward !== null) {
    const option = REWARD_OPTIONS.find((entry) => entry.value === filters.minMaxReward);

    chips.push({
      id: 'minMaxReward',
      label: option?.label ?? 'Minimum bounty',
      remove: (current) => ({ ...current, minMaxReward: null }),
    });
  }

  if (filters.closing !== null) {
    const option = CLOSING_OPTIONS.find((entry) => entry.value === filters.closing);

    chips.push({
      id: 'closing',
      label: `Closing: ${option?.label ?? filters.closing}`,
      remove: (current) => ({ ...current, closing: null }),
    });
  }

  if (filters.funded) {
    chips.push({
      id: 'funded',
      label: 'Funded pool only',
      remove: (current) => ({ ...current, funded: false }),
    });
  }

  return chips;
}

const SORT_LABELS: Readonly<Record<ProgramSort, string>> = Object.freeze({
  newest: 'newest first',
  name: 'program name',
  maxBounty: 'max bounty',
  totalPaid: 'total paid',
  deadline: 'deadline',
});

/**
 * How the rows are ordered right now. The default is not an "active only" filter — ended programs
 * are in the list, they just come after the active ones (§6), and the copy has to say exactly
 * that.
 */
export function describeSortOrder(filters: ProgramFilterState): string {
  if (filters.sort === 'newest') {
    return 'Active programs appear first';
  }

  return `Sorted by ${SORT_LABELS[filters.sort]}, ${
    filters.sortDirection === 'desc' ? 'descending' : 'ascending'
  }`;
}

/** Sentence under the toolbar: which statuses are in the list, and how they are ordered. */
export function describeOrdering(filters: ProgramFilterState): string {
  const statusPart =
    filters.status.length === 1
      ? filters.status[0] === 'active'
        ? 'Active programs only'
        : 'Ended programs only'
      : 'All statuses included';

  return `${statusPart} · ${describeSortOrder(filters)}`;
}
