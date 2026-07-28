'use client';

import { reportResponseSchema } from '@bug-bounty-escrow/shared';
import {
  Button,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  SeverityBadge,
  StatusBadge,
} from '@bug-bounty-escrow/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { CommentThread } from './comment-thread';
import { ReportIdCopy } from './copy-value';
import { ReportContent } from './report-content';
import {
  describeTime,
  formatUsdc,
  reportReferenceAriaLabel,
  REPORT_STATUS_SUMMARY,
  SEVERITY_LABELS,
  shortReportId,
} from './report-format';
import { ReportDetailSkeleton, ReportStateBlock } from './report-states';
import { ReportTimeline } from './report-timeline';
import { ReviewActions } from './review-actions';
import { useCurrentUser } from '@/hooks/use-current-user';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

/*
 * No Figma source — the reviewer's view of one report.
 *
 * It is the researcher detail screen turned around: the same private content component, the same
 * timeline, but the rail carries decisions instead of a disclosure summary. Reusing
 * `ReportContent` is the point — a reviewer must be reading exactly what the researcher sent, not
 * a second rendering of it that could drift.
 *
 * The route is guarded to owner and reviewer roles; nothing here is reachable from a public page.
 */

export interface ReviewDetailViewProps {
  readonly id: string;
}

export function ReviewDetailView({ id }: ReviewDetailViewProps) {
  const { session } = useAuth();
  const viewer = useCurrentUser();
  const token = session?.access_token;
  const principalId = session?.user.id ?? 'no-session';

  const query = useQuery({
    queryKey: queryKeys.report(principalId, id),
    enabled: session !== null,
    queryFn: () =>
      apiRequest(`/api/reports/${encodeURIComponent(id)}`, reportResponseSchema, { token }),
  });

  if (query.isPending) {
    return (
      <>
        <p aria-live="polite" className="sr-only">
          Loading the report…
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
              <Link href="/review">Back to inbox</Link>
            </Button>
          </div>
        }
        detail={
          missing
            ? 'It belongs to a program you do not own or review, or it no longer exists.'
            : 'Try again in a moment. Nothing about the report was changed.'
        }
        title={missing ? 'This report is not available' : 'We couldn’t load this report'}
        tone="error"
      />
    );
  }

  const report = query.data.data;
  const submitted = describeTime(report.submittedAt ?? report.createdAt);

  return (
    <div className="flex flex-col gap-xl">
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-sm text-body-sm text-text-muted">
          <li>
            <Link className="inline-flex min-h-11 items-center rounded-sm hover:text-text" href="/review">
              Review inbox
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li
            aria-current="page"
            aria-label={reportReferenceAriaLabel(report.id)}
            className="font-mono text-text"
          >
            {shortReportId(report.id)}
          </li>
        </ol>
      </nav>

      <header className="flex flex-col gap-md">
        <h1 className="text-h1 text-text">{report.title}</h1>
        <div className="flex flex-col gap-md lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-md">
            <StatusBadge status={report.status} />
            <SeverityBadge
              label={
                report.finalSeverity === undefined
                  ? `Proposed ${SEVERITY_LABELS[report.proposedSeverity]}`
                  : `Final ${SEVERITY_LABELS[report.finalSeverity]}`
              }
              severity={report.finalSeverity ?? report.proposedSeverity}
            />
            <p className="flex flex-wrap items-center gap-sm text-body-sm text-text-muted">
              <Link
                className="inline-flex min-h-11 items-center rounded-sm hover:text-text"
                href={`/programs/${encodeURIComponent(report.programSlug)}`}
              >
                {report.programName}
              </Link>
              {submitted === undefined ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <span title={submitted.absolute}>{`Submitted ${submitted.text}`}</span>
                </>
              )}
              {report.approvedReward === undefined ? null : (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{`${formatUsdc(report.approvedReward)} approved`}</span>
                </>
              )}
            </p>
          </div>
          <ReportIdCopy id={report.id} />
        </div>
      </header>

      <div className="grid gap-xl lg:grid-cols-[minmax(0,1fr)_338px] lg:items-start">
        <div className="flex min-w-0 flex-col gap-xl">
          <ReportContent report={report} token={token} />
      <CommentThread
        principalId={principalId}
        reportId={report.id}
            researcherId={report.researcherId}
            token={token}
            viewerId={viewer.data?.id}
          />
        </div>

        <div className="flex flex-col gap-xl lg:sticky lg:top-xl">
          <ReviewActions principalId={principalId} report={report} token={token} />

          <Card className="h-fit gap-xl" padding="lg">
            <CardHeader>
              <CardTitle>Where it stands</CardTitle>
              <CardDescription>{REPORT_STATUS_SUMMARY[report.status]}</CardDescription>
            </CardHeader>
            <ReportTimeline status={report.status} />
          </Card>
        </div>
      </div>
    </div>
  );
}
