'use client';

import type { ProgramListResponse } from '@bug-bounty-escrow/shared';
import { useCallback, useEffect, useRef, type RefObject } from 'react';

/** Start loading shortly before the reader reaches the final rendered row. */
export const BOUNTY_SENTINEL_ROOT_MARGIN = '240px';
export const BOUNTY_SENTINEL_DEBOUNCE_MS = 120;

export function getNextProgramPageParam(lastPage: ProgramListResponse): number | undefined {
  return lastPage.metadata.hasNextPage ? lastPage.metadata.page + 1 : undefined;
}

export interface InfiniteScrollRequestState {
  readonly hasNextPage: boolean;
  readonly isError: boolean;
  readonly isFetching: boolean;
  readonly requestInFlight: boolean;
}

/** Pure guard shared by the observer and its focused regression tests. */
export function canRequestNextPage(state: InfiniteScrollRequestState): boolean {
  return (
    state.hasNextPage && !state.isError && !state.isFetching && !state.requestInFlight
  );
}

export interface BountyInfiniteScrollOptions {
  readonly fetchNextPage: () => Promise<unknown>;
  readonly hasNextPage: boolean;
  readonly isError: boolean;
  readonly isFetching: boolean;
}

/**
 * Debounced IntersectionObserver with an explicit in-flight latch.
 *
 * TanStack updates `isFetching` on the next React commit. The latch closes the smaller window
 * between invoking `fetchNextPage` and that commit, so repeated observer callbacks cannot start
 * duplicate page requests.
 */
export function useBountyInfiniteScroll({
  fetchNextPage,
  hasNextPage,
  isError,
  isFetching,
}: BountyInfiniteScrollOptions): RefObject<HTMLDivElement | null> {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isIntersectingRef = useRef(false);
  const requestInFlightRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef({ fetchNextPage, hasNextPage, isError, isFetching });

  useEffect(() => {
    latestRef.current = { fetchNextPage, hasNextPage, isError, isFetching };
  }, [fetchNextPage, hasNextPage, isError, isFetching]);

  const requestNextPage = useCallback(() => {
    const current = latestRef.current;
    if (
      !canRequestNextPage({
        hasNextPage: current.hasNextPage,
        isError: current.isError,
        isFetching: current.isFetching,
        requestInFlight: requestInFlightRef.current,
      })
    ) {
      return;
    }

    requestInFlightRef.current = true;
    void current.fetchNextPage().then(
      () => {
        requestInFlightRef.current = false;
      },
      () => {
        requestInFlightRef.current = false;
      },
    );
  }, []);

  const scheduleNextPage = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      requestNextPage();
    }, BOUNTY_SENTINEL_DEBOUNCE_MS);
  }, [requestNextPage]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (node === null || typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        isIntersectingRef.current = entries.some((entry) => entry.isIntersecting);

        if (isIntersectingRef.current) {
          scheduleNextPage();
        } else if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
      },
      { rootMargin: BOUNTY_SENTINEL_ROOT_MARGIN },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, [scheduleNextPage]);

  /*
   * A short appended page can leave the sentinel inside the root without producing another
   * observer event. Once the request settles, schedule exactly one guarded follow-up.
   */
  useEffect(() => {
    if (isIntersectingRef.current && !isFetching && !isError && hasNextPage) {
      scheduleNextPage();
    }
  }, [hasNextPage, isError, isFetching, scheduleNextPage]);

  return sentinelRef;
}
