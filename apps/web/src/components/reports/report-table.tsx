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

import {
  describeTime,
  formatUsdc,
  reportReferenceAriaLabel,
  SEVERITY_LABELS,
  shortReportId,
} from './report-format';

/*
 * Figma `283:1937` — the report row, used by My reports and by the reviewer inbox.
 *
 * Shaped after `components/programs/bounty-table.tsx`: the desktop table and the mobile stack are
 * built from the same summaries so a figure cannot read one way at one breakpoint and another way
 * at the next, and the row is a single link carrying an `after:` overlay rather than a clickable
 * container full of nested controls.
 *
 * A summary is metadata only — title, program, severity, status, reward, timestamp. No disclosure
 * body is ever rendered in a list.
 */

export const REPORT_COLUMN_WIDTHS = {
  report: 'w-96 min-w-64',
  program: 'w-56 min-w-40',
  severity: 'w-44 min-w-36',
  status: 'w-48 min-w-40',
  reward: 'w-40 min-w-32',
  updated: 'w-40 min-w-32',
  action: 'w-36 min-w-28',
} as const;

function severityOf(report: ReportSummary): {
  severity: ReportSummary['proposedSeverity'];
  provenance: 'final' | 'proposed';
} {
  return report.finalSeverity === undefined
    ? { severity: report.proposedSeverity, provenance: 'proposed' }
    : { severity: report.finalSeverity, provenance: 'final' };
}

function rewardOf(report: ReportSummary): string {
  return report.approvedReward === undefined ? '—' : formatUsdc(report.approvedReward);
}

export interface ReportTableProps {
  readonly actionLabel: string;
  readonly caption: string;
  readonly heading?: string;
  readonly hrefFor: (report: ReportSummary) => string;
  readonly onOpen?: (report: ReportSummary) => void;
  readonly privacyDescription?: string;
  readonly reports: readonly ReportSummary[];
  readonly sortDescription?: string;
  /** Replaces the body with one full-width cell — skeleton, empty or error. */
  readonly bodyOverride?: ReactNode;
}

export function ReportTable({
  actionLabel,
  bodyOverride,
  caption,
  heading = 'Recent reports',
  hrefFor,
  onOpen,
  privacyDescription = 'Participant-only',
  reports,
  sortDescription = 'Newest submitted first',
}: ReportTableProps) {
  return (
    <Table containerClassName="hidden rounded-lg md:block">
      <TableCaption className="caption-top m-0 p-xl text-left">
        <span className="flex items-center justify-between gap-xl">
          <span className="text-label-lg text-text">{heading}</span>
          <span className="text-label-sm text-text-muted">
            {privacyDescription} · {sortDescription}
          </span>
        </span>
        <span className="sr-only">{caption}</span>
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
        {bodyOverride === undefined ? (
          reports.map((report) => {
            const severity = severityOf(report);
            const updated = describeTime(report.updatedAt);

            return (
              <TableRow
                className="relative h-20 has-[a:focus-visible]:bg-surface-raised"
                key={report.id}
              >
                <TableCell className={REPORT_COLUMN_WIDTHS.report}>
                  <span className="flex min-w-0 flex-col gap-xs">
                    <span className="line-clamp-2 text-body-sm font-semibold text-text">
                      {report.title}
                    </span>
                    <span
                      aria-label={reportReferenceAriaLabel(report.id)}
                      className="font-mono text-label-sm text-text-muted"
                    >
                      {shortReportId(report.id)}
                      <span aria-hidden="true">…</span>
                    </span>
                  </span>
                </TableCell>
                <TableCell className={REPORT_COLUMN_WIDTHS.program}>
                  <span className="line-clamp-2 text-body-sm text-text">{report.programName}</span>
                </TableCell>
                <TableCell className={REPORT_COLUMN_WIDTHS.severity}>
                  <SeverityBadge
                    aria-label={`${SEVERITY_LABELS[severity.severity]}, ${severity.provenance} severity`}
                    severity={severity.severity}
                  />
                </TableCell>
                <TableCell className={REPORT_COLUMN_WIDTHS.status}>
                  <StatusBadge status={report.status} />
                </TableCell>
                <TableCell className={REPORT_COLUMN_WIDTHS.reward}>
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
                <TableCell className={REPORT_COLUMN_WIDTHS.updated}>
                  {updated === undefined ? (
                    <span className="text-body-sm text-text-muted">—</span>
                  ) : (
                    <time
                      aria-label={`Updated ${updated.absolute}`}
                      className="text-body-sm text-text-muted"
                      dateTime={report.updatedAt}
                      title={updated.absolute}
                    >
                      {updated.text}
                    </time>
                  )}
                </TableCell>
                <TableCell className={`${REPORT_COLUMN_WIDTHS.action} text-right`}>
                  {/* The `after:` overlay makes the whole row clickable while the accessibility
                      tree still sees exactly one named link. */}
                  <Link
                    className="inline-flex min-h-11 items-center justify-end gap-sm rounded-sm text-body-sm text-escrow after:absolute after:inset-0 after:rounded-sm after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:ring-inset"
                    href={hrefFor(report)}
                    onClick={() => onOpen?.(report)}
                    prefetch={false}
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
            <TableCell colSpan={7}>{bodyOverride}</TableCell>
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
  onOpen,
  reports,
}: {
  readonly actionLabel: string;
  readonly hrefFor: (report: ReportSummary) => string;
  readonly onOpen?: (report: ReportSummary) => void;
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
              className="flex flex-col gap-md rounded-lg border border-border bg-surface p-lg hover:border-border-brand focus-visible:ring-2 focus-visible:ring-focus"
              href={hrefFor(report)}
              onClick={() => onOpen?.(report)}
              prefetch={false}
            >
              <span className="flex flex-col gap-xs">
                <span
                  aria-label={reportReferenceAriaLabel(report.id)}
                  className="font-mono text-label-sm text-low"
                >
                  {shortReportId(report.id)}
                  <span aria-hidden="true">…</span>
                </span>
                <span className="text-body-sm text-text">{report.title}</span>
                <span className="text-label-sm text-text-muted">{report.programName}</span>
              </span>
              <span className="flex flex-wrap items-center gap-sm">
                <StatusBadge status={report.status} />
                <SeverityBadge
                  aria-label={`${SEVERITY_LABELS[severity.severity]}, ${severity.provenance} severity`}
                  severity={severity.severity}
                />
              </span>
              <span className="flex flex-wrap items-center justify-between gap-sm text-label-sm text-text-muted">
                <span>{rewardOf(report)}</span>
                {updated === undefined ? (
                  <span>Updated recently</span>
                ) : (
                  <time
                    aria-label={`Updated ${updated.absolute}`}
                    dateTime={report.updatedAt}
                    title={updated.absolute}
                  >
                    Updated {updated.text}
                  </time>
                )}
              </span>
              <span className="sr-only">{`${actionLabel}: ${report.title}`}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
