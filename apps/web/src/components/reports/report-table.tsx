'use client';

import type { ReportSummary } from '@bug-bounty-escrow/shared';
import {
  SeverityBadge,
  StatusBadge,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bug-bounty-escrow/ui';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { describeTime, formatUsdc, SEVERITY_LABELS } from './report-format';

/*
 * No Figma source — the report row, used by My reports and by the reviewer inbox.
 *
 * Shaped after `components/programs/bounty-table.tsx`: the desktop table and the mobile stack are
 * built from the same summaries so a figure cannot read one way at one breakpoint and another way
 * at the next, and the row is a single link carrying an `after:` overlay rather than a clickable
 * container full of nested controls.
 *
 * A summary is metadata only — title, program, severity, status, reward, timestamp. No disclosure
 * body is ever rendered in a list.
 */

const COLUMN_WIDTHS = {
  report: 'w-[380px] min-w-[220px]',
  severity: 'w-[180px] min-w-[130px]',
  status: 'w-[190px] min-w-[140px]',
  reward: 'w-[170px] min-w-[120px]',
  updated: 'w-[170px] min-w-[120px]',
  action: 'w-[150px] min-w-[110px]',
} as const;

function severityOf(report: ReportSummary): { severity: ReportSummary['proposedSeverity']; note: string } {
  return report.finalSeverity === undefined
    ? { severity: report.proposedSeverity, note: 'Proposed' }
    : { severity: report.finalSeverity, note: 'Final' };
}

function rewardOf(report: ReportSummary): string {
  return report.approvedReward === undefined ? 'Not decided' : formatUsdc(report.approvedReward);
}

export interface ReportTableProps {
  readonly actionLabel: string;
  readonly caption: string;
  readonly hrefFor: (report: ReportSummary) => string;
  readonly reports: readonly ReportSummary[];
  /** Replaces the body with one full-width cell — skeleton, empty or error. */
  readonly bodyOverride?: ReactNode;
}

export function ReportTable({
  actionLabel,
  bodyOverride,
  caption,
  hrefFor,
  reports,
}: ReportTableProps) {
  return (
    <Table containerClassName="hidden rounded-lg md:block">
      <TableCaption className="sr-only">{caption}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-surface-raised">
          <TableHead className={COLUMN_WIDTHS.report}>Report</TableHead>
          <TableHead className={COLUMN_WIDTHS.severity}>Severity</TableHead>
          <TableHead className={COLUMN_WIDTHS.status}>Status</TableHead>
          <TableHead className={COLUMN_WIDTHS.reward}>Reward</TableHead>
          <TableHead className={COLUMN_WIDTHS.updated}>Updated</TableHead>
          <TableHead className={COLUMN_WIDTHS.action}>
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {bodyOverride === undefined ? (
          reports.map((report) => {
            const severity = severityOf(report);
            const updated = describeTime(report.updatedAt);

            return (
              <TableRow className="relative h-20 has-[a:focus-visible]:bg-surface-raised" key={report.id}>
                <TableCell className={COLUMN_WIDTHS.report}>
                  <span className="flex min-w-0 flex-col gap-xs">
                    <span className="truncate text-body-sm text-text">{report.title}</span>
                    <span className="truncate text-label-sm text-text-muted">
                      {report.programName}
                    </span>
                  </span>
                </TableCell>
                <TableCell className={COLUMN_WIDTHS.severity}>
                  <span className="flex flex-col items-start gap-xs">
                    <SeverityBadge severity={severity.severity} />
                    <span className="text-label-sm text-text-muted">{severity.note}</span>
                  </span>
                </TableCell>
                <TableCell className={COLUMN_WIDTHS.status}>
                  <StatusBadge status={report.status} />
                </TableCell>
                <TableCell className={COLUMN_WIDTHS.reward}>
                  <span
                    className={
                      report.approvedReward === undefined
                        ? 'text-body-sm text-text-muted'
                        : 'text-body-sm text-text'
                    }
                  >
                    {rewardOf(report)}
                  </span>
                </TableCell>
                <TableCell className={COLUMN_WIDTHS.updated}>
                  <span className="text-body-sm text-text-muted" title={updated?.absolute}>
                    {updated?.text ?? '—'}
                  </span>
                </TableCell>
                <TableCell className={`${COLUMN_WIDTHS.action} text-right`}>
                  {/* The `after:` overlay makes the whole row clickable while the accessibility
                      tree still sees exactly one named link. */}
                  <Link
                    className="inline-flex min-h-11 items-center justify-end gap-sm rounded-sm text-body-sm text-escrow after:absolute after:inset-0 after:content-['']"
                    href={hrefFor(report)}
                  >
                    {actionLabel}
                    <span className="sr-only">{`: ${report.title}`}</span>
                    <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })
        ) : (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={6}>{bodyOverride}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

/** Below `md` the same summaries stack as cards; the whole card is the link. */
export function ReportCardList({
  actionLabel,
  hrefFor,
  reports,
}: {
  readonly actionLabel: string;
  readonly hrefFor: (report: ReportSummary) => string;
  readonly reports: readonly ReportSummary[];
}) {
  return (
    <ul className="flex flex-col gap-md md:hidden">
      {reports.map((report) => {
        const severity = severityOf(report);
        const updated = describeTime(report.updatedAt);

        return (
          <li key={report.id}>
            <Link
              className="flex flex-col gap-md rounded-lg border border-border bg-surface p-lg hover:border-border-brand"
              href={hrefFor(report)}
            >
              <span className="flex flex-col gap-xs">
                <span className="text-body-sm text-text">{report.title}</span>
                <span className="text-label-sm text-text-muted">{report.programName}</span>
              </span>
              <span className="flex flex-wrap items-center gap-sm">
                <StatusBadge status={report.status} />
                <SeverityBadge
                  label={`${severity.note} ${SEVERITY_LABELS[severity.severity]}`}
                  severity={severity.severity}
                />
              </span>
              <span className="flex flex-wrap items-center justify-between gap-sm text-label-sm text-text-muted">
                <span>{rewardOf(report)}</span>
                <span title={updated?.absolute}>{`Updated ${updated?.text ?? 'recently'}`}</span>
              </span>
              <span className="sr-only">{`${actionLabel}: ${report.title}`}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
