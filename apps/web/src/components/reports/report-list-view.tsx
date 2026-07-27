'use client';

import {
  reportListResponseSchema,
  researcherReportSummaryResponseSchema,
} from '@bug-bounty-escrow/shared';
import { Button } from '@bug-bounty-escrow/ui';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import {
  ReportFilterBar,
  toReportQueryKey,
  toReportSearchParams,
  useReportFilters,
} from './report-filters';
import { reportDetailHref, reportListHref } from './report-detail-model';
import { ReportListSkeleton, ReportStateBlock } from './report-states';
import {
  ReportPageHeader,
  ReportSummaryMetrics,
  ReportSummarySkeleton,
} from './report-summary';
import { ReportCardList, ReportTable } from './report-table';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

/*
 * No Figma source — "My reports", the destination of the SR-07 secondary action and of the
 * researcher account menu.
 *
 * Composed from the patterns already in `components/programs/`: URL-held filters, `keepPreviousData`
 * so a filter change keeps the current rows on screen instead of flashing empty, one shared row
 * component for desktop and mobile, and three distinct message states (nothing yet / nothing
 * matches / could not load) rather than a single ambiguous "no results".
 *
 * Paging is an explicit `Load more` button rather than the bounty table's infinite scroll: this
 * list is short, and a footer the reader can actually reach is worth more than endless scrolling.
 */

const PAGE_SIZE = 20;

export function ReportListView() {
  const { session } = useAuth();
  const controls = useReportFilters();
  const summaryQuery = useQuery({
    queryKey: queryKeys.reportSummary,
    enabled: session !== null,
    queryFn: () =>
      apiRequest('/api/reports/summary', researcherReportSummaryResponseSchema, {
        token: session?.access_token,
      }),
  });

  const query = useInfiniteQuery({
    queryKey: queryKeys.reports(toReportQueryKey(controls.filters, 'mine')),
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
  const returnTo = reportListHref(controls.filters);

  return (
    <div className="flex flex-col gap-xl">
      <ReportPageHeader />

      {summaryQuery.isPending ? (
        <ReportSummarySkeleton />
      ) : summaryQuery.data === undefined ? null : (
        <ReportSummaryMetrics summary={summaryQuery.data.data} />
      )}

      <ReportFilterBar controls={controls} />

      <p aria-live="polite" className="text-body-sm text-text-muted">
        {query.isPending
          ? 'Loading your reports…'
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
          title="We couldn’t load your reports"
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
              <Button asChild>
                <Link href="/programs">Browse programs</Link>
              </Button>
            }
            detail="Once you submit a private report it appears here, with its review status and any reward."
            title="No reports yet"
          />
        )
      ) : (
        <>
          <ReportTable
            actionLabel="Open"
            caption="Your private reports, with severity, review status, reward and last update."
            hrefFor={(report) => reportDetailHref(report.id, returnTo)}
            reports={reports}
          />
          <ReportCardList
            actionLabel="Open"
            hrefFor={(report) => reportDetailHref(report.id, returnTo)}
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
