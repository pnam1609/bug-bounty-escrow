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
          : 'mx-auto flex max-w-md flex-col items-center gap-md px-xl py-2xl text-center'
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
