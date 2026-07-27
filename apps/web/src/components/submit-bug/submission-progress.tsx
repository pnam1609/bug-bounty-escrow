'use client';

/*
 * SR-05 "Submitting your private report…" and SR-06 "Report submitted. Uploading private
 * attachment…" — Figma `149:1693` and `149:1798`, matched closely: the PRIVATE DISCLOSURE pill,
 * a circular glyph, the heading pair, and three status rows whose right-hand tag reads
 * IN PROGRESS / COMPLETE / UPLOADING / SKIPPED.
 *
 * There is no percentage: the client has no real upload progress, so it never claims one. The
 * whole composer is replaced while this runs, which is what locks the stepper, Back, the file
 * controls and the primary action.
 */

import { LoaderCircle, Upload } from 'lucide-react';

import { ComposerStatusCard } from './composer-frame';

export const PROGRESS_STATES = Object.freeze(['complete', 'active', 'upcoming', 'skipped'] as const);
export type ProgressState = (typeof PROGRESS_STATES)[number];

const STATE_TAG: Readonly<Record<ProgressState, string>> = Object.freeze({
  complete: 'Complete',
  active: 'In progress',
  upcoming: 'Waiting',
  skipped: 'Skipped',
});

const STATE_TAG_COLOR: Readonly<Record<ProgressState, string>> = Object.freeze({
  complete: '[color:var(--color-escrow)]',
  active: '[color:var(--color-low)]',
  upcoming: '[color:var(--color-text-disabled)]',
  skipped: '[color:var(--color-text-disabled)]',
});

const STATE_DOT: Readonly<Record<ProgressState, string>> = Object.freeze({
  complete: 'bg-escrow',
  active: 'bg-primary',
  upcoming: 'bg-text-disabled',
  skipped: 'bg-text-disabled',
});

function ProgressRow({
  detail,
  label,
  state,
}: {
  readonly detail: string;
  readonly label: string;
  readonly state: ProgressState;
}) {
  return (
    <li
      className={`flex items-center gap-md rounded-md border p-lg text-start ${
        state === 'active' ? 'border-border-brand bg-ambient' : 'border-border bg-surface-raised'
      }`}
      data-state={state}
    >
      <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${STATE_DOT[state]}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-xs">
        <span className="text-label-lg text-text">{label}</span>
        <span className="break-all text-label-sm text-text-muted">{detail}</span>
      </span>
      <span className={`shrink-0 text-label-sm font-semibold uppercase ${STATE_TAG_COLOR[state]}`}>
        {STATE_TAG[state]}
      </span>
    </li>
  );
}

export interface SubmissionProgressProps {
  readonly attachmentDetail: string;
  readonly creating: ProgressState;
  readonly opening: ProgressState;
  readonly uploading: ProgressState;
}

export function SubmissionProgress({
  attachmentDetail,
  creating,
  opening,
  uploading,
}: SubmissionProgressProps) {
  const isUploadPhase = uploading === 'active';

  return (
    <ComposerStatusCard>
      <span className="inline-flex items-center rounded-full border border-escrow bg-surface-raised px-md py-xs text-label-sm uppercase [color:var(--color-escrow)]">
        Private disclosure
      </span>
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full border border-border bg-surface-raised"
      >
        {isUploadPhase ? (
          <Upload className="size-6 text-text" />
        ) : (
          <LoaderCircle className="size-6 text-text motion-safe:animate-spin" />
        )}
      </span>
      <div className="flex flex-col gap-sm">
        <h1 aria-live="polite" className="text-h2 text-text">
          {isUploadPhase
            ? 'Report submitted. Uploading private attachment…'
            : 'Submitting your private report…'}
        </h1>
        <p className="text-body-sm text-text-muted">
          {isUploadPhase
            ? 'Your disclosure is secure. Keep this tab open while the proof uploads.'
            : 'We’re creating the report securely. Keep this tab open.'}
        </p>
      </div>
      <ol className="flex w-full flex-col gap-md">
        <ProgressRow
          detail="Encrypting and saving the disclosure"
          label="Creating report"
          state={creating}
        />
        <ProgressRow detail={attachmentDetail} label="Uploading attachment" state={uploading} />
        <ProgressRow
          detail="Redirecting to the private report detail"
          label="Opening report"
          state={opening}
        />
      </ol>
      <p className="text-label-sm text-text-muted">
        No report content is sent to analytics or application logs. The signed upload link is
        short-lived and is never persisted.
      </p>
    </ComposerStatusCard>
  );
}
