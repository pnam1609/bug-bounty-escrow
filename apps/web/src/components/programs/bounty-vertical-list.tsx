'use client';

import type { ProgramSummary } from '@bug-bounty-escrow/shared';
import { Card, Separator } from '@bug-bounty-escrow/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import {
  describeDeadline,
  formatMoney,
  formatTotalPaid,
  programMonogram,
} from './program-format';

/*
 * `Bounty Vertical Row` (Figma `171:1267`) — the sub-768px representation of a table row.
 *
 * A `<table>` squeezed into a phone either scrolls sideways or loses its semantics, so below the
 * breakpoint each record becomes a bordered block with a `<dl>` of label/value pairs and a
 * full-width action (§10). Same data, same formatters as the desktop table.
 */

export function BountyVerticalList({
  programs,
}: {
  readonly programs: readonly ProgramSummary[];
}) {
  return (
    <ul className="flex flex-col gap-lg">
      {programs.map((program) => (
        <li key={program.id}>
          <BountyVerticalRow program={program} />
        </li>
      ))}
    </ul>
  );
}

function BountyVerticalRow({ program }: { readonly program: ProgramSummary }) {
  const maxBounty = formatMoney(program.maxBounty, 'maximum bounty');
  const publicTotalPaid = program.totalPaidVisibility === 'public' ? program.totalPaid : null;
  const totalPaid = formatTotalPaid(publicTotalPaid);
  const deadline = describeDeadline(program);

  return (
    <Card className="relative gap-md" padding="md">
      <div className="flex items-center gap-md">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary text-h3 text-primary-contrast"
        >
          {programMonogram(program.name)}
        </span>
        <h3 className="min-w-0 truncate text-h3 text-text">{program.name}</h3>
      </div>

      <Separator />

      <dl className="flex flex-col gap-sm">
        <div className="flex items-baseline justify-between gap-md">
          <dt className="text-body-sm text-text-muted">Max bounty</dt>
          <dd className="text-body-sm text-text">
            <span aria-hidden="true">{maxBounty.text}</span>
            <span className="sr-only">{maxBounty.label}</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-md">
          <dt className="text-body-sm text-text-muted">Total paid</dt>
          <dd
            className={
              publicTotalPaid === null ? 'text-body-sm text-text-muted' : 'text-body-sm text-text'
            }
          >
            <span aria-hidden="true">{totalPaid.text}</span>
            <span className="sr-only">{totalPaid.label}</span>
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-md">
          <dt className="text-body-sm text-text-muted">Deadline</dt>
          <dd
            className={
              deadline.ended ? 'text-body-sm text-text-muted' : 'text-body-sm text-text'
            }
          >
            <span aria-hidden="true">{deadline.primary}</span>
            <span className="sr-only">{deadline.label}</span>
          </dd>
        </div>
      </dl>

      {/* One stretched link per card: the whole block is tappable without nesting controls. */}
      <Link
        className="inline-flex min-h-11 items-center justify-center gap-sm rounded-full border border-border bg-surface-raised text-label-lg font-semibold text-text after:absolute after:inset-0 after:content-['']"
        href={`/programs/${program.id}`}
      >
        View bounty
        <span className="sr-only"> for {program.name}</span>
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </Card>
  );
}

export function BountyVerticalSkeleton({ rows = 3 }: { readonly rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-lg">
      {Array.from({ length: rows }, (_, index) => (
        <div
          className="flex flex-col gap-md rounded-lg border border-border bg-surface p-xl"
          key={index}
        >
          <div className="flex items-center gap-md">
            <span className="size-10 rounded-md bg-surface-raised motion-safe:animate-pulse" />
            <span className="h-4 w-32 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
          </div>
          <span className="h-3 w-full rounded-sm bg-surface-raised motion-safe:animate-pulse" />
          <span className="h-3 w-full rounded-sm bg-surface-raised motion-safe:animate-pulse" />
          <span className="h-11 w-full rounded-full bg-surface-raised motion-safe:animate-pulse" />
        </div>
      ))}
    </div>
  );
}
