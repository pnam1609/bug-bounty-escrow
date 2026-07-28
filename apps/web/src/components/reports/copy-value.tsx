'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { reportReferenceAriaLabel, shortReportId } from './report-format';

/*
 * No Figma source for the button itself — SR-07 `151:198` draws the line as
 * `Report ID  BBE-4821   Copy` in the info tone, which is the `low` token the design system also
 * uses for `StatusBadge variant="info"`.
 *
 * The id shown is the real one, truncated. The API issues UUIDs, so a friendly `BBE-4821` would be
 * a second identifier that resolves to nothing; the full value goes on the clipboard and into the
 * accessible name instead.
 */

const RESET_AFTER_MS = 2000;

export interface CopyButtonProps {
  /** What lands on the clipboard. */
  readonly value: string;
  /** Completes the accessible name, e.g. "report id". */
  readonly what: string;
}

export function CopyButton({ value, what }: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current !== null) clearTimeout(timer.current);

    try {
      // `navigator.clipboard` is undefined on an insecure origin, so this is guarded rather than
      // assumed; the failure path tells the reader to copy by hand instead of failing silently.
      await navigator.clipboard.writeText(value);
      setState('copied');
    } catch {
      setState('failed');
    }

    timer.current = setTimeout(() => setState('idle'), RESET_AFTER_MS);
  }

  return (
    <>
      <button
        className="inline-flex min-h-11 items-center gap-xs rounded-sm px-sm text-label-md text-low hover:underline"
        onClick={() => void copy()}
        type="button"
      >
        {state === 'copied' ? (
          <Check aria-hidden="true" className="size-4 shrink-0" />
        ) : (
          <Copy aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span>Copy</span>
        <span className="sr-only">{` the full ${what}`}</span>
      </button>
      <span aria-live="polite" className="text-label-sm text-text-muted">
        {state === 'copied' ? 'Copied' : state === 'failed' ? 'Press Ctrl+C to copy' : ''}
      </span>
    </>
  );
}

export interface ReportIdCopyProps {
  readonly id: string;
}

/** `Report ID  <short id>  Copy` — the right-hand meta line of SR-07. */
export function ReportIdCopy({ id }: ReportIdCopyProps) {
  return (
    <p className="flex flex-wrap items-center gap-sm">
      <span className="text-label-md text-text-muted">Report ID</span>
      <span
        aria-label={reportReferenceAriaLabel(id)}
        className="font-mono text-label-md text-text"
        title={id}
      >
        {shortReportId(id)}
        <span aria-hidden="true">…</span>
      </span>
      <CopyButton value={id} what="report id" />
    </p>
  );
}
