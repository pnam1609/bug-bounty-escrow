'use client';

import { Button, Card } from '@bug-bounty-escrow/ui';
import type { ReactNode } from 'react';

/*
 * No Figma source — the message and skeleton states for the report surfaces.
 *
 * Shaped after `components/programs/bounty-states.tsx`: one centred block, a title, one supporting
 * sentence and at most one action. Nothing here ever prints a response body or an error code, and
 * an error block carries `role="alert"` plus a red border rather than red text alone.
 */

export interface ReportStateBlockProps {
  readonly action?: ReactNode;
  readonly detail: string;
  readonly title: string;
  readonly tone?: 'default' | 'error';
}

export function ReportStateBlock({
  action,
  detail,
  title,
  tone = 'default',
}: ReportStateBlockProps) {
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

export function ReportLoadError({
  detail = 'Try again in a moment. Nothing was changed.',
  onRetry,
  title = 'We couldn’t load this',
}: {
  readonly detail?: string;
  readonly onRetry: () => void;
  readonly title?: string;
}) {
  return (
    <ReportStateBlock
      action={<Button onClick={onRetry}>Try again</Button>}
      detail={detail}
      title={title}
      tone="error"
    />
  );
}

/**
 * Purely decorative placeholder. `aria-hidden` keeps a screen reader out of the shimmering
 * boxes — the live region on the surface itself announces that the page is loading.
 */
export function ReportListSkeleton({ rows = 4 }: { readonly rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-md">
      {Array.from({ length: rows }, (_, index) => (
        <Card className="h-24" key={index} />
      ))}
    </div>
  );
}

export function ReportDetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-xl">
      <span className="h-4 w-48 rounded-sm bg-surface-raised motion-safe:animate-pulse" />
      <span className="h-20 w-full rounded-md bg-surface-raised motion-safe:animate-pulse" />
      <span className="h-10 w-2/3 max-w-lg rounded-sm bg-surface-raised motion-safe:animate-pulse" />
      <div className="grid gap-xl lg:grid-cols-3">
        <Card className="h-96 lg:col-span-2" />
        <Card className="h-80" />
      </div>
    </div>
  );
}
