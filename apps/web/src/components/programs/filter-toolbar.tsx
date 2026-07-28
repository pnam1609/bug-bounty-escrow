'use client';

import { Input } from '@bug-bounty-escrow/ui';
import { Search } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import { FilterChips } from './filter-chips';
import { MoreFiltersPopover, MultiFilterPopover, SingleFilterPopover } from './filter-popovers';
import { ProgramFilterSheet } from './filter-sheet';
import {
  ASSET_TYPE_OPTIONS,
  REWARD_ANY_LABEL,
  REWARD_OPTIONS,
  SEARCH_MAX_LENGTH,
  STATUS_OPTIONS,
  describeAppliedFilters,
  statusSelectionForControls,
  type ProgramFilterState,
} from './program-filters';

/*
 * The bounty-table toolbar: filter buttons on the left, search on the right, applied chips on the
 * row underneath (§6).
 *
 * Below the table breakpoint the four popovers collapse into the single bottom sheet and the
 * search grows to full width. Sort never appears here — the column headers own it.
 */

const SEARCH_DEBOUNCE_MS = 350;

export interface ProgramFilterToolbarProps {
  readonly filters: ProgramFilterState;
  /** Commits a filter change and pushes a history entry. */
  readonly onApply: (next: ProgramFilterState) => void;
  /** Commits without a history entry — used while the search field is being typed into. */
  readonly onApplyQuietly: (next: ProgramFilterState) => void;
  readonly onClearAll: () => void;
  readonly isRefreshing?: boolean;
}

export function ProgramFilterToolbar({
  filters,
  isRefreshing = false,
  onApply,
  onApplyQuietly,
  onClearAll,
}: ProgramFilterToolbarProps) {
  const searchId = useId();
  const chips = describeAppliedFilters(filters);

  /*
   * The field is a local draft debounced into the URL. `committed` remembers what the URL last
   * agreed with, which lets the effect below tell "the user is typing" apart from "Back/Forward
   * or a chip removal changed the search behind us" and re-seed only in the second case.
   */
  const [draftSearch, setDraftSearch] = useState(filters.search);
  const committed = useRef(filters.search);

  useEffect(() => {
    if (filters.search !== committed.current) {
      committed.current = filters.search;
      setDraftSearch(filters.search);
    }
  }, [filters.search]);

  useEffect(() => {
    if (draftSearch === committed.current) {
      return undefined;
    }

    const timer = setTimeout(() => {
      committed.current = draftSearch;
      onApplyQuietly({ ...filters, search: draftSearch });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [draftSearch, filters, onApplyQuietly]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    committed.current = draftSearch;
    onApply({ ...filters, search: draftSearch });
  }

  return (
    <div className="relative flex flex-col gap-lg">
      <div className="flex flex-col gap-lg md:flex-row md:items-end md:justify-between">
        <form
          className="order-1 flex flex-col gap-sm md:order-2 md:w-96"
          onSubmit={submitSearch}
          role="search"
        >
          <label className="text-label-md text-text" htmlFor={searchId}>
            Search bounties
          </label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-md top-1/2 size-4 -translate-y-1/2 text-text-muted"
            />
            <Input
              className="pl-2xl"
              id={searchId}
              maxLength={SEARCH_MAX_LENGTH}
              onChange={(event) => setDraftSearch(event.target.value.slice(0, SEARCH_MAX_LENGTH))}
              placeholder="Search in table"
              size="lg"
              type="search"
              value={draftSearch}
            />
          </div>
        </form>

        <div className="order-2 md:order-1">
          <div className="hidden flex-wrap items-center gap-md md:flex">
            <MultiFilterPopover
              appliedCount={filters.status.length}
              label="Status"
              onApply={(status) => onApply({ ...filters, status })}
              options={STATUS_OPTIONS}
              searchLabel="Search values"
              searchPlaceholder="Search statuses"
              selected={statusSelectionForControls(filters.status)}
            />
            <MultiFilterPopover
              label="Asset type"
              onApply={(assetType) => onApply({ ...filters, assetType })}
              options={ASSET_TYPE_OPTIONS}
              searchLabel="Search values"
              searchPlaceholder="Search asset types"
              selected={filters.assetType}
            />
            <SingleFilterPopover
              anyLabel={REWARD_ANY_LABEL}
              label="Max bounty"
              onApply={(minMaxReward) => onApply({ ...filters, minMaxReward })}
              options={REWARD_OPTIONS}
              value={filters.minMaxReward}
            />
            <MoreFiltersPopover
              onApply={(more) =>
                onApply({
                  ...filters,
                  severity: more.severity,
                  closing: more.closing,
                  funded: more.funded,
                })
              }
              value={{
                severity: filters.severity,
                closing: filters.closing,
                funded: filters.funded,
              }}
            />
          </div>
          <div className="md:hidden">
            <ProgramFilterSheet filters={filters} onApply={onApply} />
          </div>
        </div>
      </div>

      {chips.length === 0 ? null : (
        <FilterChips chips={chips} filters={filters} onChange={onApply} onClearAll={onClearAll} />
      )}

      {isRefreshing ? (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-sm h-0.5 overflow-hidden rounded-full bg-surface-raised"
        >
          <span className="block h-full w-1/3 rounded-full bg-primary motion-safe:animate-pulse" />
        </div>
      ) : null}
    </div>
  );
}
