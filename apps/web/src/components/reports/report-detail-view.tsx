'use client';

import { reportResponseSchema, type ReportDetail } from '@bug-bounty-escrow/shared';
import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  SeverityBadge,
  StatusBadge,
} from '@bug-bounty-escrow/ui';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

import { CommentThread } from './comment-thread';
import { ReportIdCopy } from './copy-value';
import { ReportContent } from './report-content';
import { safeReportListReturnTo } from './report-detail-model';
import {
  describeTime,
  formatTimestamp,
  REPORT_STATUS_SUMMARY,
  SEVERITY_LABELS,
  shortReportId,
} from './report-format';
import { ReportDetailSkeleton, ReportStateBlock } from './report-states';
import { ReportTimeline } from './report-timeline';
import { ASSET_TYPE_LABELS } from '@/components/programs/program-format';
import { useCurrentUser } from '@/hooks/use-current-user';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

/*
 * SR-12 report detail, Figma `272:1882`, with the freshly submitted state from SR-07 `151:105`.
 * This route is `/reports/:id` for every status; SR-07 is what it looks like immediately after a
 * successful submit, which is where the composer lands.
 *
 * Frame geometry, translated to tokens:
 *   content column   1104px (1440 frame, 168px gutters)  → ResearcherShell width="detail"
 *   columns          wide content + narrow summary rail → three-column token grid, gap-xl
 *   success banner   surface-raised, success border, Shadow/Subtle, mint disc + check
 *   header           H1 title, status badge, program · proposed severity · submitted time
 *   right meta       "Report ID … Copy" in the info tone (the `low` token)
 *   status card      H2 "Report status", 5-stage timeline, primary + secondary actions
 *   rail             "Disclosure summary" definition list + mint safety reminder
 *
 * Two deliberate departures from the raster, both noted where they occur: the status pill uses the
 * library `StatusBadge` rather than the frame's one-off violet rectangle, and a third secondary
 * action (`Back to program`) is present because flow §8 SR-07 lists it.
 */

export const SUBMITTED_SUCCESS_TITLE = 'Report submitted privately';
export const SUBMITTED_SUCCESS_DESCRIPTION =
  "The program's authorized reviewers can now review your disclosure.";
export const REPORT_NOT_FOUND_TITLE = 'Report not found';
export const REPORT_NOT_FOUND_DESCRIPTION =
  'The report may no longer exist or may not be available to this account.';

export function SuccessBanner() {
  return (
    <div
      className="flex items-start gap-lg rounded-md border border-success bg-surface-raised p-lg shadow-subtle"
      role="status"
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-escrow text-background"
      >
        <Check className="size-5" />
      </span>
      <div className="flex min-w-0 flex-col gap-xs">
        <p className="text-h3 text-text">{SUBMITTED_SUCCESS_TITLE}</p>
        <p className="text-body-sm text-text-muted">{SUBMITTED_SUCCESS_DESCRIPTION}</p>
      </div>
    </div>
  );
}

function RailRow({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <div className="flex flex-col gap-xs">
      <dt className="text-label-sm text-text-muted">{label}</dt>
      <dd className="text-body-sm text-text">{children}</dd>
    </div>
  );
}

function DisclosureSummary({ report }: { readonly report: ReportDetail }) {
  const attachment = report.attachments[0];

  return (
    <Card className="h-fit gap-xl" padding="lg">
      <CardHeader>
        <CardTitle>Disclosure summary</CardTitle>
      </CardHeader>

      <dl className="flex flex-col gap-lg">
        <RailRow label="Affected scope">
          <span className="flex flex-wrap items-center gap-sm">
            <span>{`${report.affectedScope.name} · ${ASSET_TYPE_LABELS[report.affectedScope.assetType]}`}</span>
            <Link
              className="inline-flex min-h-11 items-center rounded-sm text-label-md text-low hover:underline"
              href={`/programs/${encodeURIComponent(report.programId)}?tab=scope`}
            >
              View scope
            </Link>
          </span>
        </RailRow>
        <RailRow label="Severity">
          <span className="flex flex-wrap items-center gap-sm">
            <SeverityBadge severity={report.finalSeverity ?? report.proposedSeverity} />
            <span className="text-label-sm text-text-muted">
              {report.finalSeverity === undefined ? 'Proposed' : 'Final, set by the reviewer'}
            </span>
          </span>
        </RailRow>
        <RailRow label="Attachment">
          {attachment === undefined ? (
            'None'
          ) : (
            <span className="break-all">
              {attachment.filename}
              {report.attachments.length > 1
                ? ` +${String(report.attachments.length - 1)} more`
                : ''}
            </span>
          )}
        </RailRow>
        <RailRow label="Visibility">Authorized reviewers</RailRow>
        <RailRow label="Wallet">Not required</RailRow>
        {report.approvedReward === undefined ? null : (
          <RailRow label="Approved reward">{`${report.approvedReward} USDC`}</RailRow>
        )}
      </dl>

      <p className="flex items-start gap-md rounded-md border border-border bg-surface-raised p-md text-body-sm text-text-muted">
        <span aria-hidden="true" className="mt-sm size-sm shrink-0 rounded-full bg-escrow" />
        Keep sensitive follow-up inside this private report thread.
      </p>
    </Card>
  );
}

export function InformationRequestCallout({ report }: { readonly report: ReportDetail }) {
  if (report.status !== 'needs_information') return null;

  return (
    <Callout title="A reviewer needs more information" variant="warning">
      <div className="flex flex-col items-start gap-md">
        {report.latestInformationRequest === undefined ? null : (
          <blockquote className="flex w-full flex-col gap-xs rounded-md border border-border bg-surface p-md">
            <p className="text-label-sm uppercase text-text-muted">Latest reviewer request</p>
            <p className="whitespace-pre-wrap break-words text-body-sm text-text">
              {report.latestInformationRequest.message}
            </p>
            <time
              className="text-label-sm text-text-muted"
              dateTime={report.latestInformationRequest.requestedAt}
            >
              {formatTimestamp(report.latestInformationRequest.requestedAt)}
            </time>
          </blockquote>
        )}
        <p>Answer in the private discussion below to keep the follow-up with this report.</p>
        {report.capabilities.canResubmit ? (
          <Button asChild variant="secondary">
            <Link
              href={`/reports/new?programId=${encodeURIComponent(report.programId)}&reportId=${encodeURIComponent(report.id)}`}
            >
              Edit and resubmit
            </Link>
          </Button>
        ) : null}
      </div>
    </Callout>
  );
}

export interface ReportDetailViewProps {
  readonly id: string;
}

export function ReportDetailView({ id }: ReportDetailViewProps) {
  const { session } = useAuth();
  const viewer = useCurrentUser();
  const searchParams = useSearchParams();
  const token = session?.access_token;
  const reportsHref = safeReportListReturnTo(searchParams.get('returnTo'));

  const query = useQuery({
    queryKey: queryKeys.report(id),
    queryFn: () =>
      apiRequest(`/api/reports/${encodeURIComponent(id)}`, reportResponseSchema, { token }),
  });

  if (query.isPending) {
    return (
      <>
        <p aria-live="polite" className="sr-only">
          Loading your private report…
        </p>
        <ReportDetailSkeleton />
      </>
    );
  }

  if (query.isError) {
    const missing =
      query.error instanceof ApiClientError &&
      (query.error.status === 404 || query.error.status === 403);

    return (
      <ReportStateBlock
        action={
          <div className="flex flex-wrap justify-center gap-md">
            {missing ? null : <Button onClick={() => void query.refetch()}>Try again</Button>}
            <Button asChild variant="secondary">
              <Link href={reportsHref}>My reports</Link>
            </Button>
          </div>
        }
        detail={
          missing
            ? REPORT_NOT_FOUND_DESCRIPTION
            : 'Try again in a moment. Nothing about the report was changed.'
        }
        title={missing ? REPORT_NOT_FOUND_TITLE : 'We couldn’t load this report'}
        tone="error"
      />
    );
  }

  const report = query.data.data;
  const submittedAt = describeTime(report.submittedAt ?? report.createdAt);
  const isFreshlySubmitted = report.status === 'submitted';

  return (
    <div className="flex flex-col gap-xl">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-sm text-body-sm text-text-muted">
          <li>
            <Link
              className="inline-flex min-h-11 items-center rounded-sm hover:text-text"
              href={reportsHref}
            >
              My reports
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="font-mono text-text">
            {shortReportId(report.id)}
          </li>
        </ol>
      </nav>

      {isFreshlySubmitted ? <SuccessBanner /> : null}

      <header className="flex flex-col gap-md">
        <h1 className="text-h1 text-text">{report.title}</h1>
        <div className="flex flex-col gap-md lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-md">
            {/* The frame draws a bespoke violet rectangle here; the design system owns the report
                status ramp (`26:25`), so the library badge is used instead — otherwise "Submitted"
                would read one way here and another way one click away on My reports. */}
            <StatusBadge status={report.status} />
            <p className="flex flex-wrap items-center gap-sm text-body-sm text-text-muted">
              <Link
                className="inline-flex min-h-11 items-center rounded-sm hover:text-text"
                href={`/programs/${encodeURIComponent(report.programId)}`}
              >
                {report.programName}
              </Link>
              <span aria-hidden="true">·</span>
              <span>{`Proposed ${SEVERITY_LABELS[report.proposedSeverity]}`}</span>
              {submittedAt === undefined ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <time
                    aria-label={`Submitted ${submittedAt.absolute}`}
                    dateTime={report.submittedAt ?? report.createdAt}
                    title={submittedAt.absolute}
                  >{`Submitted ${submittedAt.text}`}</time>
                </>
              )}
            </p>
          </div>
          <ReportIdCopy id={report.id} />
        </div>
      </header>

      <InformationRequestCallout report={report} />

      <div className="grid gap-xl lg:grid-cols-3 lg:items-start">
        <Card className="gap-xl lg:col-span-2" padding="lg">
          <CardHeader>
            <CardTitle className="text-h2">Report status</CardTitle>
            <CardDescription>
              Follow the review here and respond if more information is requested.
            </CardDescription>
          </CardHeader>

          <p aria-live="polite" className="text-body-sm text-text">
            {REPORT_STATUS_SUMMARY[report.status]}
          </p>

          <ReportTimeline status={report.status} />

          <p className="text-body-sm text-text-muted">
            Watch for reviewer questions in this report. It stays private by default. A separate
            owner decision after the program ends is required before any public Known Issue can be
            created.
          </p>

          <div className="flex flex-wrap gap-md">
            <Button asChild size="lg">
              <a href="#report-content">View report</a>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href={reportsHref}>My reports</Link>
            </Button>
            {/* Flow §8 SR-07 lists this third action; the raster only draws the first two. */}
            <Button asChild size="lg" variant="secondary">
              <Link href={`/programs/${encodeURIComponent(report.programId)}`}>
                Back to program
              </Link>
            </Button>
          </div>
        </Card>

        <DisclosureSummary report={report} />
      </div>

      <ReportContent report={report} token={token} />

      <CommentThread
        reportId={report.id}
        researcherId={report.researcherId}
        token={token}
        viewerId={viewer.data?.id}
      />
    </div>
  );
}
