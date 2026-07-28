'use client';

import {
  Button,
  Card,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bug-bounty-escrow/ui';
import type { ReactNode } from 'react';

import { ReportPageHeader, ReportSummarySkeleton } from './report-summary';
import { REPORT_COLUMN_WIDTHS } from './report-table';

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
  const columns = [
    ['report', 'w-40'],
    ['program', 'w-28'],
    ['severity', 'w-20'],
    ['status', 'w-24'],
    ['reward', 'w-16'],
    ['updated', 'w-20'],
    ['action', 'w-12'],
  ] as const;

  return (
    <div aria-label="Loading reports" role="status">
      <div aria-hidden="true">
        <Table containerClassName="hidden rounded-lg md:block">
          <TableCaption className="caption-top m-0 p-xl text-left">
            <span className="flex items-center justify-between gap-xl">
              <span className="text-label-lg text-text">Recent reports</span>
              <span className="text-label-sm text-text-muted">
                Participant-only · Newest submitted first
              </span>
            </span>
          </TableCaption>
          <TableHeader>
            <TableRow className="hover:bg-surface-raised">
              <TableHead className={REPORT_COLUMN_WIDTHS.report}>Report</TableHead>
              <TableHead className={REPORT_COLUMN_WIDTHS.program}>Program</TableHead>
              <TableHead className={REPORT_COLUMN_WIDTHS.severity}>Severity</TableHead>
              <TableHead className={REPORT_COLUMN_WIDTHS.status}>Status</TableHead>
              <TableHead className={REPORT_COLUMN_WIDTHS.reward}>Reward</TableHead>
              <TableHead className={REPORT_COLUMN_WIDTHS.updated}>Updated</TableHead>
              <TableHead className={`${REPORT_COLUMN_WIDTHS.action} text-right`}>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: rows }, (_, row) => (
              <TableRow className="h-20" key={row}>
                {columns.map(([column, width]) => (
                  <TableCell
                    className={REPORT_COLUMN_WIDTHS[column]}
                    key={`${String(row)}-${column}`}
                  >
                    <span
                      className={`block h-4 animate-pulse rounded-sm bg-ambient motion-reduce:animate-none ${width}`}
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-col gap-md md:hidden">
          {Array.from({ length: rows }, (_, row) => (
            <Card className="gap-md" key={row}>
              <span className="h-4 w-40 animate-pulse rounded-sm bg-ambient motion-reduce:animate-none" />
              <span className="h-4 w-28 animate-pulse rounded-sm bg-ambient motion-reduce:animate-none" />
              <span className="h-8 w-48 animate-pulse rounded-full bg-ambient motion-reduce:animate-none" />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReportFilterSkeleton() {
  const fields = [
    ['Program', 'sm:w-72'],
    ['Status', 'sm:w-64'],
    ['Severity', 'sm:w-60'],
  ] as const;

  return (
    <div aria-label="Loading report filters" role="status">
      <div aria-hidden="true" className="flex flex-col gap-lg sm:flex-row sm:items-end">
        {fields.map(([label, width]) => (
          <div className={`flex flex-col gap-sm ${width}`} key={label}>
            <span className="text-label-lg text-text">{label}</span>
            <span className="h-14 rounded-md border border-border bg-surface" />
          </div>
        ))}
        <Button className="sm:mb-px" disabled size="lg" variant="ghost">
          Reset filters
        </Button>
      </div>
    </div>
  );
}

/** Suspense fallback with the same major geometry as the settled My Reports screen. */
export function ReportListPageSkeleton() {
  return (
    <div className="flex flex-col gap-xl">
      <ReportPageHeader />
      <ReportSummarySkeleton />
      <ReportFilterSkeleton />
      <ReportListSkeleton />
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
