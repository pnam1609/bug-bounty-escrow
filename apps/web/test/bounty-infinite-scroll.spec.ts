import type { ProgramListResponse } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  canRequestNextPage,
  getNextProgramPageParam,
} from '@/components/programs/bounty-infinite-scroll';
import {
  BountyFilterSkeleton,
  BountyHeadingMetaSkeleton,
  BountyInfiniteStatus,
} from '@/components/programs/bounty-infinite-states';

function page(pageNumber: number, hasNextPage: boolean): ProgramListResponse {
  return {
    success: true,
    data: [],
    metadata: {
      page: pageNumber,
      limit: 6,
      totalItems: hasNextPage ? pageNumber * 6 + 1 : pageNumber * 6,
      totalPages: hasNextPage ? pageNumber + 1 : pageNumber,
      hasNextPage,
      hasPreviousPage: pageNumber > 1,
    },
  };
}

describe('BT-06 page-based infinite query', () => {
  it('starts after the current API page only while metadata says another page exists', () => {
    expect(getNextProgramPageParam(page(1, true))).toBe(2);
    expect(getNextProgramPageParam(page(4, true))).toBe(5);
    expect(getNextProgramPageParam(page(4, false))).toBeUndefined();
  });

  it('blocks duplicate, concurrent, failed and terminal observer requests', () => {
    expect(
      canRequestNextPage({
        hasNextPage: true,
        isError: false,
        isFetching: false,
        requestInFlight: false,
      }),
    ).toBe(true);

    for (const state of [
      { hasNextPage: false, isError: false, isFetching: false, requestInFlight: false },
      { hasNextPage: true, isError: true, isFetching: false, requestInFlight: false },
      { hasNextPage: true, isError: false, isFetching: true, requestInFlight: false },
      { hasNextPage: true, isError: false, isFetching: false, requestInFlight: true },
    ]) {
      expect(canRequestNextPage(state)).toBe(false);
    }
  });
});

describe('BT-06 infinite list states', () => {
  it('keeps load-more and terminal states inline without pagination controls', () => {
    const loading = renderToStaticMarkup(
      createElement(BountyInfiniteStatus, {
        hasNextPage: true,
        hasPrograms: true,
        isLoadMoreError: false,
        isLoadingMore: true,
        onRetry: vi.fn(),
      }),
    );
    const ended = renderToStaticMarkup(
      createElement(BountyInfiniteStatus, {
        hasNextPage: false,
        hasPrograms: true,
        isLoadMoreError: false,
        isLoadingMore: false,
        onRetry: vi.fn(),
      }),
    );
    const failed = renderToStaticMarkup(
      createElement(BountyInfiniteStatus, {
        hasNextPage: true,
        hasPrograms: true,
        isLoadMoreError: true,
        isLoadingMore: false,
        onRetry: vi.fn(),
      }),
    );

    expect(loading).toContain('Loading more bounties…');
    expect(loading).toContain('motion-safe:animate-spin');
    expect(ended).toContain('reached the end');
    expect(failed).toContain('Couldn&#x27;t load more');
    expect(failed).toContain('Try again');
    expect(`${loading}${ended}${failed}`).not.toMatch(/pagination|page \d/iu);
  });

  it('renders filter and heading skeletons without fake result data', () => {
    const markup =
      renderToStaticMarkup(createElement(BountyFilterSkeleton)) +
      renderToStaticMarkup(createElement(BountyHeadingMetaSkeleton));

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('motion-safe:animate-pulse');
    expect(markup).not.toContain('Aegis');
    expect(markup).not.toContain('USDC');
  });
});
