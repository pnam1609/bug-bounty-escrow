'use client';

import { programListResponseSchema } from '@bug-bounty-escrow/shared';
import { Button } from '@bug-bounty-escrow/ui';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { ChevronDown, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { BountyEmptyFiltered, BountyEmptyInitial, BountyLoadError } from './bounty-states';
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

/** Distance ahead of the viewport at which the next page starts loading. */
const SENTINEL_ROOT_MARGIN = '240px';

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
    getNextPageParam: (lastPage) =>
      lastPage.metadata.hasNextPage ? lastPage.metadata.page + 1 : undefined,
    placeholderData: keepPreviousData,
  });

  const pages = query.data?.pages ?? [];
  const programs = pages.flatMap((page) => page.data);
  const totalItems = pages[0]?.metadata.totalItems;
  const isFiltered = hasNarrowingFilters(filters);
  const isRefreshing = query.isPlaceholderData;
  /* A failed *first* page replaces the table; a failed load-more keeps the rows already read. */
  const isInitialError = query.isError && programs.length === 0;
  const isLoadMoreError = query.isError && programs.length > 0;

  /* ── Infinite scroll ─────────────────────────────────────────────────────────────────── */

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isIntersecting = useRef(false);
  const latest = useRef(query);

  // Declared first so the effect below always reads the state from this same commit.
  useEffect(() => {
    latest.current = query;
  });

  useEffect(() => {
    const node = sentinelRef.current;

    if (node === null || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        isIntersecting.current = entries.some((entry) => entry.isIntersecting);

        if (isIntersecting.current) {
          requestNextPage();
        }
      },
      { rootMargin: SENTINEL_ROOT_MARGIN },
    );

    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  /*
   * Appending a page does not always push the sentinel back out of view, and no second
   * intersection event is fired while it stays inside the root. Re-checking once the in-flight
   * request settles is what keeps a short page from stalling the list.
   */
  useEffect(() => {
    if (isIntersecting.current) {
      requestNextPage();
    }
  }, [query.isFetching, query.hasNextPage, query.isError]);

  function requestNextPage() {
    const current = latest.current;

    // `isFetching` covers the initial load and the refetch as well as load-more, so this is also
    // the guarantee that only one request is ever in flight.
    if (current.hasNextPage && !current.isFetching && !current.isError) {
      void current.fetchNextPage();
    }
  }

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
    if (query.isPending) {
      return skeleton;
    }

    if (isInitialError) {
      return <BountyLoadError onRetry={() => void query.refetch()} />;
    }

    if (programs.length === 0) {
      return isFiltered ? <BountyEmptyFiltered onClearAll={clearAll} /> : <BountyEmptyInitial />;
    }

    return undefined;
  }

  function handleSort(column: ProgramSort) {
    apply(toggleProgramSort(filters, column));
  }

  const resultsLabel =
    totalItems === undefined
      ? 'Loading bounty programs'
      : isFiltered
        ? `${totalItems} matching ${totalItems === 1 ? 'program' : 'programs'}`
        : `${totalItems} bounty ${totalItems === 1 ? 'program' : 'programs'}`;

  const desktopBody = stateBody(<BountyTableSkeletonBody />);
  const mobileBody = stateBody(<BountyVerticalSkeleton />);

  return (
    <div className="flex flex-col gap-2xl">
      <DiscoveryHero />

      <ProgramFilterToolbar
        filters={filters}
        onApply={apply}
        onApplyQuietly={applyQuietly}
        onClearAll={clearAll}
      />

      <div className="flex flex-col gap-md">
        <div className="flex flex-wrap items-baseline justify-between gap-md">
          <p className="text-h3 text-text">{isRefreshing ? 'Updating results…' : resultsLabel}</p>
          <p className="text-label-md text-text-muted">
            {isRefreshing ? 'Keeping current results visible' : describeSortOrder(filters)}
          </p>
        </div>
        {isRefreshing ? (
          <div
            aria-hidden="true"
            className="h-0.5 w-full overflow-hidden rounded-full bg-surface-raised"
          >
            <span className="block h-full w-1/3 rounded-full bg-primary motion-safe:animate-pulse" />
          </div>
        ) : null}
        {/* Only this region speaks, and only once a request has settled. */}
        <p aria-live="polite" className="sr-only" role="status">
          {announcement}
        </p>
      </div>

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
      <div className="md:hidden">
        {mobileBody ?? <BountyVerticalList programs={programs} />}
      </div>

      <div className="flex flex-col gap-lg" ref={sentinelRef}>
        {isLoadMoreError ? (
          <div
            className="flex flex-wrap items-center gap-md text-body-sm text-text"
            role="alert"
          >
            <span>Couldn&rsquo;t load more</span>
            <Button onClick={() => void query.fetchNextPage()} variant="secondary">
              Try again
            </Button>
          </div>
        ) : query.isFetchingNextPage ? (
          <p className="flex items-center gap-sm text-body-sm text-text-muted">
            <LoaderCircle
              aria-hidden="true"
              className="size-4 motion-safe:animate-spin"
            />
            Loading more bounties…
          </p>
        ) : query.hasNextPage ? (
          <p className="flex items-center gap-sm text-body-sm text-text-muted">
            <ChevronDown aria-hidden="true" className="size-4" />
            Scroll to load more bounties
          </p>
        ) : programs.length > 0 ? (
          <p className="text-body-sm text-text-muted">You&rsquo;ve reached the end</p>
        ) : null}
      </div>

      <p className="border-t border-border pt-lg text-label-md text-text-muted">
        Reward pools are shown in USDC. Always review the complete in-scope assets and exclusions
        before testing or submitting a report.
      </p>
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
      <div className="hidden md:block">
        <BountyTableSkeletonBody />
      </div>
      <div className="md:hidden">
        <BountyVerticalSkeleton />
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
      <ul className="flex shrink-0 flex-col gap-sm rounded-lg border border-border bg-surface px-lg py-md">
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
