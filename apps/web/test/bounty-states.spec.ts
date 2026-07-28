import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  BOUNTY_SAFETY_NOTE,
  BountyEmptyFiltered,
  BountyEmptyInitial,
  BountyLoadError,
  BountySafetyNote,
  resolveBountyListState,
  shouldShowBountyInfiniteStatus,
} from '@/components/programs/bounty-states';

describe('BT-07 bounty table states', () => {
  it('renders empty-initial copy without a clear-filters action', () => {
    const html = renderToStaticMarkup(createElement(BountyEmptyInitial));

    expect(html).toContain('No bounty programs yet');
    expect(html).toContain('New public programs will appear here when they are published.');
    expect(html).not.toContain('<button');
    expect(html).not.toContain('Clear');
  });

  it('renders empty-filtered copy with the primary clear-all action', () => {
    const html = renderToStaticMarkup(createElement(BountyEmptyFiltered, { onClearAll: vi.fn() }));

    expect(html).toContain('No bounties match these filters');
    expect(html).toContain('Try removing a filter or searching for a different program.');
    expect(html).toContain('Clear all filters');
    expect(html).toContain('bg-primary');
  });

  it('renders a safe retry state without exposing an error body or technical code', () => {
    const html = renderToStaticMarkup(createElement(BountyLoadError, { onRetry: vi.fn() }));

    expect(html).toContain('We couldn’t load bounties');
    expect(html).toContain('Your filters are still here. Try again in a moment.');
    expect(html).toContain('Retry');
    expect(html).toContain('role="alert"');
    expect(html).not.toMatch(/response|stack|error[_ -]?code|request_failed/iu);
  });

  it('shows primary request failures even when placeholder rows are still present', () => {
    expect(
      resolveBountyListState({
        isError: true,
        isFetchNextPageError: false,
        isFiltered: true,
        isPending: false,
        programCount: 6,
      }),
    ).toBe('error');

    expect(
      resolveBountyListState({
        isError: true,
        isFetchNextPageError: true,
        isFiltered: true,
        isPending: false,
        programCount: 6,
      }),
    ).toBe('ready');
  });

  it('distinguishes initial and filtered empty datasets', () => {
    const base = {
      isError: false,
      isFetchNextPageError: false,
      isPending: false,
      programCount: 0,
    };

    expect(resolveBountyListState({ ...base, isFiltered: false })).toBe('empty-initial');
    expect(resolveBountyListState({ ...base, isFiltered: true })).toBe('empty-filtered');
  });

  it('suppresses infinite-scroll copy outside a populated ready table', () => {
    expect(shouldShowBountyInfiniteStatus('ready')).toBe(true);

    for (const state of ['loading', 'error', 'empty-initial', 'empty-filtered'] as const) {
      expect(shouldShowBountyInfiniteStatus(state)).toBe(false);
    }
  });

  it('renders the exact safety note without payout guarantees or AI gate language', () => {
    const html = renderToStaticMarkup(createElement(BountySafetyNote));

    expect(html).toContain(BOUNTY_SAFETY_NOTE);
    expect(html.toLowerCase()).not.toContain('guaranteed payout');
    expect(html.toLowerCase()).not.toMatch(/ai.{0,20}(rank|gate)/u);
  });
});
