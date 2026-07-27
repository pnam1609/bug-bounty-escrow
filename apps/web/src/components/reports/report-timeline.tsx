'use client';

import { Check } from 'lucide-react';

import { REPORT_TIMELINE, timelineProgress, type ReportStatus } from './report-format';

/*
 * The five-stage review timeline drawn in SR-07 `151:105` ("Report status" card, nodes
 * 151:202 → 151:225).
 *
 * Geometry from the frame: a 28px node, a 2px connector on the node's centre line, labels at
 * Body/Small in full-strength text and sub-labels at Label/Small in muted text. Figma draws every
 * connector in `--bbe-color-border`, including the one below the completed node, so they all stay
 * on the border token here rather than turning mint behind progress.
 *
 * State never rests on the mint disc alone: a completed stage carries a check glyph, the waiting
 * stage carries a visible "Next" chip, and every stage announces its state to a screen reader.
 */

type StageState = 'complete' | 'next' | 'upcoming' | 'closed';

const NODE_CLASSES: Readonly<Record<StageState, string>> = Object.freeze({
  complete: 'border-escrow bg-escrow text-background',
  next: 'border-border-brand bg-surface-raised text-text',
  upcoming: 'border-border bg-surface-raised text-text-muted',
  closed: 'border-border bg-surface-raised text-text-disabled',
});

const LABEL_CLASSES: Readonly<Record<StageState, string>> = Object.freeze({
  complete: 'text-text',
  next: 'text-text',
  upcoming: 'text-text',
  closed: 'text-text-disabled',
});

const STATE_WORDS: Readonly<Record<StageState, string>> = Object.freeze({
  complete: 'Completed',
  next: 'Next',
  upcoming: 'Upcoming',
  closed: 'Not applicable — the report closed earlier',
});

export interface ReportTimelineProps {
  readonly status: ReportStatus;
}

export function ReportTimeline({ status }: ReportTimelineProps) {
  const progress = timelineProgress(status);
  const lastIndex = REPORT_TIMELINE.length - 1;

  return (
    <ol aria-label="Review timeline" className="flex flex-col">
      {REPORT_TIMELINE.map((stage, index) => {
        const state: StageState =
          index < progress.completed
            ? 'complete'
            : progress.closed
              ? 'closed'
              : index === progress.next
                ? 'next'
                : 'upcoming';
        const isLast = index === lastIndex;
        const isCurrent = status === 'submitted' ? index === 0 : state === 'next';

        return (
          <li
            aria-current={isCurrent ? 'step' : undefined}
            className="flex gap-lg"
            data-state={state}
            key={stage.id}
          >
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-label-md ${NODE_CLASSES[state]}`}
              >
                {state === 'complete' ? (
                  <Check className="size-4" />
                ) : (
                  String(index + 1)
                )}
              </span>
              {isLast ? null : (
                <span aria-hidden="true" className="min-h-lg w-0.5 flex-1 bg-border" />
              )}
            </div>

            <div className={`flex min-w-0 flex-col gap-xs ${isLast ? '' : 'pb-lg'}`}>
              <p className="flex flex-wrap items-center gap-sm">
                <span className={`text-body-sm ${LABEL_CLASSES[state]}`}>{stage.label}</span>
                {state === 'next' ? (
                  <span className="inline-flex items-center rounded-full border border-border-brand bg-surface-raised px-sm py-px text-label-sm uppercase text-primary">
                    Next
                  </span>
                ) : null}
              </p>
              <p className="text-label-sm text-text-muted">{stage.detail}</p>
              <span className="sr-only">{STATE_WORDS[state]}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
