'use client';

/*
 * SR-11 — Program closed or paused. Figma `154:112`, matched closely: amber circular glyph, the
 * heading pair, a mint-dotted "your local draft is still available" panel, two actions and the
 * closing note.
 *
 * Reached either because the program was not active when the composer loaded, or because the
 * server answered a submit with `program_not_accepting_reports`. Either way the local draft is
 * kept and there is no retry loop.
 */

import { Button } from '@bug-bounty-escrow/ui';
import { TriangleAlert } from 'lucide-react';
import Link from 'next/link';

import { ComposerStatusCard } from './composer-frame';

export interface ProgramClosedProps {
  readonly draftSummary: string;
  readonly programId: string;
}

export function ProgramClosed({ draftSummary, programId }: ProgramClosedProps) {
  return (
    <ComposerStatusCard>
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full border border-medium bg-surface-raised"
      >
        <TriangleAlert className="size-6 [color:var(--color-medium)]" />
      </span>
      <div className="flex flex-col gap-sm">
        <h1 className="text-h2 text-text">This program is no longer accepting reports</h1>
        <p className="text-body-sm text-text-muted">
          The program changed while you were preparing this disclosure. Your local draft is still
          available in this browser.
        </p>
      </div>

      <div className="flex w-full items-start gap-md rounded-md border border-border bg-surface-raised p-lg text-start">
        <span aria-hidden="true" className="mt-sm size-2.5 shrink-0 rounded-full bg-escrow" />
        <div className="flex flex-col gap-xs">
          <p className="text-label-lg text-text">Your local draft is still available in this browser</p>
          <p className="text-label-sm text-text-muted">{draftSummary}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-md">
        <Button asChild>
          <Link href={`/programs/${programId}`}>View program</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/programs">Back to programs</Link>
        </Button>
      </div>

      <p className="text-label-sm text-text-muted">
        A closed or paused program cannot be bypassed by retrying the submit request.
      </p>
    </ComposerStatusCard>
  );
}
