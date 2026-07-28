'use client';

import { programListResponseSchema } from '@bug-bounty-escrow/shared';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { getNextProgramPageParam, useBountyInfiniteScroll } from './bounty-infinite-scroll';
import {
  BountyFilterSkeleton,
  BountyHeadingMetaSkeleton,
  BountyInfiniteStatus,
} from './bounty-infinite-states';
import {
  BountyEmptyFiltered,
  BountyEmptyInitial,
  BountyLoadError,
  BountySafetyNote,
  resolveBountyListState,
  shouldShowBountyInfiniteStatus,
} from './bounty-states';
import { BountyTable, BountyTableSkeletonBody } from './bounty-table';
import { BountyVerticalList, BountyVerticalSkeleton } from './bounty-vertical-list';
import { ProgramFilterToolbar } from './filter-toolbar';
import {
  describeSortOrder,
  hasNarrowingFilters,
  toggleProgramSort,
  toApiSearchParams,
  toQueryKeyFilters,
  useProgramFilters,
  type ProgramSort,
} from './program-filters';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

/*
 * The public bounty table — `RS-00` and every supporting state from `BT-02` to `BT-10`.
 *
 * Paging is infinite scroll, never a pager: an `IntersectionObserver` watches a sentinel placed
 * directly after the table body and asks for the next page, with a single request in flight at
 * any moment (§8). Filters and the column sort live in the URL, so a change to either produces a
 * new query key, discards the cached pages and restarts at page 1 on its own.
 *
 * `keepPreviousData` is what makes a filter change keep the current rows on screen behind a small
 * progress indicator instead of flashing an empty table (§9).
 */

export function BountyTableView() {
  const { filters, apply, applyQuietly, clearAll } = useProgramFilters();

  const query = useInfiniteQuery({
    queryKey: queryKeys.programs(toQueryKeyFilters(filters)),
    queryFn: ({ pageParam }) =>
      apiRequest(
        `/api/programs?${toApiSearchParams(filters, pageParam)}`,
        programListResponseSchema,
      ),
    initialPageParam: 1,
    getNextPageParam: getNextProgramPageParam,
    placeholderData: keepPreviousData,
  });

  const pages = query.data?.pages ?? [];
  const programs = pages.flatMap((page) => page.data);
  const totalItems = pages[0]?.metadata.totalItems;
  const isFiltered = hasNarrowingFilters(filters);
  const isRefreshing = query.isPlaceholderData;
  const listState = resolveBountyListState({
    isError: query.isError,
    isFetchNextPageError: query.isFetchNextPageError,
    isFiltered,
    isPending: query.isPending,
    programCount: programs.length,
  });
  /* A failed first/filter request replaces the table; load-more keeps the rows already read. */
  const isLoadMoreError = query.isFetchNextPageError && programs.length > 0;

  /* ── Infinite scroll ─────────────────────────────────────────────────────────────────── */

  const sentinelRef = useBountyInfiniteScroll({
    fetchNextPage: () => query.fetchNextPage({ cancelRefetch: false }),
    hasNextPage: query.hasNextPage,
    isError: query.isFetchNextPageError,
    isFetching: query.isFetching,
  });

  /* ── Results announcement ────────────────────────────────────────────────────────────── */

  /*
   * Announced once a request settles, never on every keystroke (§6). It is a region of its own
   * rather than `aria-live` on the visible count, which would also fire for placeholder data.
   */
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (query.isFetching || query.isPlaceholderData) {
      return;
    }

    if (query.isError) {
      setAnnouncement('Bounties could not be loaded. Your filters are unchanged.');
      return;
    }

    if (totalItems === undefined) {
      return;
    }

    setAnnouncement(
      `${totalItems} ${totalItems === 1 ? 'bounty program' : 'bounty programs'} ${
        isFiltered ? 'match these filters' : 'available'
      }`,
    );
  }, [isFiltered, query.isError, query.isFetching, query.isPlaceholderData, totalItems]);

  /* ── Body selection ──────────────────────────────────────────────────────────────────── */

  function stateBody(skeleton: ReactNode): ReactNode | undefined {
    if (listState === 'loading') {
      return skeleton;
    }

    if (listState === 'error') {
      return <BountyLoadError onRetry={() => void query.refetch()} />;
    }

    if (listState === 'empty-filtered') {
      return <BountyEmptyFiltered onClearAll={clearAll} />;
    }

    if (listState === 'empty-initial') {
      return <BountyEmptyInitial />;
    }

    return undefined;
  }

  function handleSort(column: ProgramSort) {
    apply(toggleProgramSort(filters, column));
  }

  const resultsLabel =
    listState === 'error'
      ? 'Programs unavailable'
      : totalItems === undefined
        ? 'Loading bounty programs'
        : isFiltered
          ? `${totalItems} matching ${totalItems === 1 ? 'program' : 'programs'}`
          : `${totalItems} bounty ${totalItems === 1 ? 'program' : 'programs'}`;

  const desktopBody = stateBody(<BountyTableSkeletonBody />);
  const mobileBody = stateBody(<BountyVerticalSkeleton rows={6} />);

  return (
    <div className="flex flex-col gap-2xl">
      <DiscoveryHero />

      {query.isPending ? (
        <BountyFilterSkeleton />
      ) : (
        <ProgramFilterToolbar
          filters={filters}
          isRefreshing={isRefreshing}
          onApply={apply}
          onApplyQuietly={applyQuietly}
          onClearAll={clearAll}
        />
      )}

      {query.isPending ? (
        <BountyHeadingMetaSkeleton />
      ) : (
        <div className="flex flex-col gap-md">
          <div className="flex flex-wrap items-baseline justify-between gap-md">
            <p className="text-h3 text-text">{resultsLabel}</p>
            <p className="text-label-md text-text-muted">{describeSortOrder(filters)}</p>
          </div>
          {/* Only this region speaks, and only once a request has settled. */}
          <p aria-live="polite" className="sr-only" role="status">
            {announcement}
          </p>
        </div>
      )}

      {/* One data source, two representations. `hidden` keeps the inactive one out of the
          accessibility tree as well as out of the layout, so nothing is read twice. */}
      <div className="hidden md:block">
        <BountyTable
          bodyOverride={desktopBody}
          caption="Public bounty programs, active programs first"
          onSort={handleSort}
          programs={programs}
          sortState={{ sort: filters.sort, direction: filters.sortDirection }}
        />
      </div>
      <div className="md:hidden">{mobileBody ?? <BountyVerticalList programs={programs} />}</div>

      <div className="flex flex-col gap-lg" ref={sentinelRef}>
        {shouldShowBountyInfiniteStatus(listState) ? (
          <BountyInfiniteStatus
            hasNextPage={query.hasNextPage}
            hasPrograms={programs.length > 0}
            isLoadMoreError={isLoadMoreError}
            isLoadingMore={query.isFetchingNextPage}
            onRetry={() => void query.fetchNextPage({ cancelRefetch: false })}
          />
        ) : null}
      </div>

      <BountySafetyNote />
    </div>
  );
}

/**
 * Suspense fallback for the route. `useSearchParams` suspends until the client has the query
 * string, and the hero is static copy, so only the data region needs a placeholder.
 */
export function BountyTableViewFallback() {
  return (
    <div className="flex flex-col gap-2xl">
      <DiscoveryHero />
      <BountyFilterSkeleton />
      <BountyHeadingMetaSkeleton />
      <div className="hidden md:block">
        <BountyTableSkeletonBody />
      </div>
      <div className="md:hidden">
        <BountyVerticalSkeleton rows={6} />
      </div>
      <p className="sr-only" role="status">
        Loading bounty programs
      </p>
    </div>
  );
}

export function DiscoveryHero() {
  return (
    <div className="flex flex-col gap-xl md:flex-row md:items-start md:justify-between">
      <div className="flex max-w-3xl flex-col gap-sm">
        <h1 className="text-h1 text-text">Find your next bounty</h1>
        <p className="text-body text-text-muted">
          Compare transparent reward pools, verified scope and USDC payouts before you start
          researching.
        </p>
      </div>
      {/* Two verifiable facts. Escrow makes the money visible; it does not guarantee a payout. */}
      <ul className="hidden shrink-0 flex-col gap-sm rounded-lg border border-border bg-surface px-lg py-md md:flex">
        <li className="flex items-center gap-sm text-label-lg text-usdc">
          <span aria-hidden="true" className="size-2 rounded-full bg-usdc" />
          Escrow balance visible
        </li>
        <li className="flex items-center gap-sm text-label-lg text-text-muted">
          <span aria-hidden="true" className="size-2 rounded-full bg-text-muted" />
          Private reports by default
        </li>
      </ul>
    </div>
  );
}
