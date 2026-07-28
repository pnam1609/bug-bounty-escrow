'use client';

import { Button } from '@bug-bounty-escrow/ui';
import type { ReactNode } from 'react';

/*
 * The three message states of the bounty list — `BT-06`, `BT-07`, `BT-08`.
 *
 * Copy is verbatim from docs/flow/bounty-table-program-list-for-figma.md §9. One block serves the
 * desktop table and the mobile list so the wording cannot drift between breakpoints, and nothing
 * here ever prints a response body or a technical error code.
 */

export type BountyListState = 'loading' | 'error' | 'empty-initial' | 'empty-filtered' | 'ready';

/**
 * A failed filter/search request may still carry placeholder rows from the previous query.
 * Classifying primary errors independently from row count prevents those stale rows from hiding
 * the Retry state. A load-more failure is different: it deliberately keeps the loaded rows.
 */
export function resolveBountyListState({
  isError,
  isFetchNextPageError,
  isFiltered,
  isPending,
  programCount,
}: {
  readonly isError: boolean;
  readonly isFetchNextPageError: boolean;
  readonly isFiltered: boolean;
  readonly isPending: boolean;
  readonly programCount: number;
}): BountyListState {
  if (isPending) {
    return 'loading';
  }

  if (isError && !isFetchNextPageError) {
    return 'error';
  }

  if (programCount === 0) {
    return isFiltered ? 'empty-filtered' : 'empty-initial';
  }

  return 'ready';
}

/** Sentinel copy belongs only to a populated table, never to loading, empty or primary-error UI. */
export function shouldShowBountyInfiniteStatus(state: BountyListState): boolean {
  return state === 'ready';
}

function StateBlock({
  action,
  detail,
  title,
  tone = 'default',
}: {
  readonly action?: ReactNode;
  readonly detail: string;
  readonly title: string;
  readonly tone?: 'default' | 'error';
}) {
  return (
    <div
      className={
        tone === 'error'
          ? 'mx-auto flex max-w-md flex-col items-center gap-md rounded-md border border-error bg-surface-raised px-xl py-2xl text-center'
          : 'mx-auto flex max-w-md flex-col items-center gap-md px-xl py-2xl text-center md:min-h-96 md:justify-center'
      }
      role={tone === 'error' ? 'alert' : undefined}
    >
      <p className="text-h3 text-text">{title}</p>
      <p className="text-body-sm text-text-muted">{detail}</p>
      {action}
    </div>
  );
}

/** No public program exists at all, so there is nothing for a `Clear filters` action to undo. */
export function BountyEmptyInitial() {
  return (
    <StateBlock
      detail="New public programs will appear here when they are published."
      title="No bounty programs yet"
    />
  );
}

export function BountyEmptyFiltered({ onClearAll }: { readonly onClearAll: () => void }) {
  return (
    <StateBlock
      action={<Button onClick={onClearAll}>Clear all filters</Button>}
      detail="Try removing a filter or searching for a different program."
      title="No bounties match these filters"
    />
  );
}

/** Retry re-runs the same request: the filters are still in the URL and are never cleared. */
export function BountyLoadError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <StateBlock
      action={<Button onClick={onRetry}>Retry</Button>}
      detail="Your filters are still here. Try again in a moment."
      title={'We couldn’t load bounties'}
      tone="error"
    />
  );
}

export const BOUNTY_SAFETY_NOTE =
  'Reward pools are shown in USDC. Always review the complete in-scope assets and exclusions before testing or submitting a report.';

export function BountySafetyNote() {
  return (
    <p className="border-t border-border pt-lg text-label-md text-text-muted">
      {BOUNTY_SAFETY_NOTE}
    </p>
  );
}
