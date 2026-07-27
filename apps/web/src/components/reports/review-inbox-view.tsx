'use client';

import { reportListResponseSchema } from '@bug-bounty-escrow/shared';
import { Button, Callout } from '@bug-bounty-escrow/ui';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';

import {
  ReportFilterBar,
  toReportQueryKey,
  toReportSearchParams,
  useReportFilters,
} from './report-filters';
import { ReportListSkeleton, ReportStateBlock } from './report-states';
import { ReportCardList, ReportTable } from './report-table';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

/*
 * No Figma source — the reviewer inbox.
 *
 * Same list machinery as My reports, and deliberately so: a reviewer and a researcher looking at
 * the same report should read the same row. What differs is the scope note, the destination of the
 * row link and the action word.
 *
 * `GET /api/reports` is scoped server-side to the programs the caller owns or is assigned to
 * review, so there is no client-side ownership filter to get wrong.
 */

const PAGE_SIZE = 20;

export function ReviewInboxView() {
  const { session } = useAuth();
  const controls = useReportFilters();

  const query = useInfiniteQuery({
    queryKey: queryKeys.reports(toReportQueryKey(controls.filters, 'review')),
    enabled: session !== null,
    queryFn: ({ pageParam }) =>
      apiRequest(
        `/api/reports?${toReportSearchParams(controls.filters, pageParam, PAGE_SIZE)}`,
        reportListResponseSchema,
        { token: session?.access_token },
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.metadata.hasNextPage ? lastPage.metadata.page + 1 : undefined,
    placeholderData: keepPreviousData,
  });

  const reports = query.data?.pages.flatMap((page) => page.data) ?? [];
  const total = query.data?.pages[0]?.metadata.totalItems;
  const isInitialError = query.isError && reports.length === 0;

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-col gap-sm">
        <p className="text-label-sm uppercase text-primary">Manual review</p>
        <h1 className="text-h1 text-text">Report inbox</h1>
        <p className="max-w-[62ch] text-body text-text-muted">
          Only reports for programs you own or are assigned to review are listed here. Opening a
          report shows the full private disclosure and the decisions available at its current stage.
        </p>
      </header>

      <Callout title="Every decision is recorded" variant="info">
        Validate, reject, duplicate, reward and payment steps are all irreversible transitions
        attributed to your account. Ask for more information when a report is not yet decidable.
      </Callout>

      <ReportFilterBar controls={controls} />

      <p aria-live="polite" className="text-body-sm text-text-muted">
        {query.isPending
          ? 'Loading the inbox…'
          : total === undefined
            ? ''
            : `${String(total)} report${total === 1 ? '' : 's'}${controls.isFiltered ? ' match these filters' : ''}`}
      </p>

      {query.isPending ? (
        <ReportListSkeleton />
      ) : isInitialError ? (
        <ReportStateBlock
          action={<Button onClick={() => void query.refetch()}>Try again</Button>}
          detail="Your filters are still here. Try again in a moment."
          title="We couldn’t load the inbox"
          tone="error"
        />
      ) : reports.length === 0 ? (
        controls.isFiltered ? (
          <ReportStateBlock
            action={
              <Button onClick={controls.clearAll} variant="secondary">
                Clear filters
              </Button>
            }
            detail="Try a different status or severity."
            title="No reports match these filters"
          />
        ) : (
          <ReportStateBlock
            action={
              <Button asChild variant="secondary">
                <Link href="/programs">Browse programs</Link>
              </Button>
            }
            detail="Reports filed against programs you own or review will arrive here."
            title="Inbox clear"
          />
        )
      ) : (
        <>
          <ReportTable
            actionLabel="Review"
            caption="Reports awaiting or completed review, with severity, status, reward and last update."
            hrefFor={(report) => `/review/${report.id}`}
            reports={reports}
          />
          <ReportCardList
            actionLabel="Review"
            hrefFor={(report) => `/review/${report.id}`}
            reports={reports}
          />

          {query.hasNextPage ? (
            <Button
              className="self-center"
              loading={query.isFetchingNextPage}
              loadingLabel="Loading more reports"
              onClick={() => void query.fetchNextPage()}
              variant="secondary"
            >
              Load more
            </Button>
          ) : null}

          {query.isError ? (
            <p className="text-body-sm text-error" role="alert">
              The next page could not be loaded. The reports already listed are unaffected.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
