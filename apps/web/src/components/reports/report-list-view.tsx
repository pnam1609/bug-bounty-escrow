'use client';

import {
  reportListResponseSchema,
  reportProgramFilterOptionsResponseSchema,
  researcherReportSummaryResponseSchema,
} from '@bug-bounty-escrow/shared';
import { Button } from '@bug-bounty-escrow/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';

import {
  ReportFilterBar,
  REPORT_PROGRAM_FILTER_OPTIONS_PATH,
  toReportQueryKey,
  toReportSearchParams,
  useReportFilters,
} from './report-filters';
import { NeedsInformationAlert } from './needs-information-alert';
import { getReportAccessFailure, reportAccessDestination } from './report-access';
import { reportDetailHref, reportListHref } from './report-detail-model';
import {
  getActiveReportFilterChips,
  ReportAccountEmptyState,
  ReportFilteredEmptyState,
  resolveReportEmptyState,
} from './report-empty-states';
import { REPORT_STATUS_OPTIONS, SEVERITY_OPTIONS } from './report-format';
import { ReportPagination } from './report-pagination';
import { ReportListSkeleton, ReportStateBlock } from './report-states';
import { ReportPageHeader, ReportSummaryMetrics, ReportSummarySkeleton } from './report-summary';
import { ReportCardList, ReportTable } from './report-table';
import { apiRequest } from '@/lib/api-client';
import { myReportsRowOpenedEvent, trackMyReportsEvent } from '@/lib/my-reports-analytics';
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
 * Pagination is server-owned. URL state selects exactly one 20-row page and the API metadata
 * drives every label and enabled/disabled state.
 */

const PAGE_SIZE = 20;

export function ReportListView() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const principalId = session?.user.id ?? 'no-session';
  const controls = useReportFilters();
  const lastViewedSnapshot = useRef<string | undefined>(undefined);
  const summaryQuery = useQuery({
    queryKey: queryKeys.reportSummary(principalId),
    enabled: session !== null,
    queryFn: () =>
      apiRequest('/api/reports/summary', researcherReportSummaryResponseSchema, {
        token: session?.access_token,
      }),
  });
  const programOptionsQuery = useQuery({
    queryKey: queryKeys.reportProgramFilterOptions(principalId),
    enabled: session !== null,
    queryFn: () =>
      apiRequest(REPORT_PROGRAM_FILTER_OPTIONS_PATH, reportProgramFilterOptionsResponseSchema, {
        token: session?.access_token,
      }),
    staleTime: 60_000,
  });

  const query = useQuery({
    queryKey: queryKeys.reports(
      principalId,
      toReportQueryKey(controls.filters, 'mine', controls.page),
    ),
    enabled: session !== null,
    queryFn: () =>
      apiRequest(
        `/api/reports?${toReportSearchParams(controls.filters, controls.page, PAGE_SIZE)}`,
        reportListResponseSchema,
        { token: session?.access_token },
      ),
    placeholderData: keepPreviousData,
  });

  const reports = query.data?.data ?? [];
  const metadata = query.data?.metadata;
  const isInitialError = query.isError && query.data === undefined;
  const accessFailure = getReportAccessFailure(
    query.error,
    summaryQuery.error,
    programOptionsQuery.error,
  );
  const returnTo = reportListHref(controls.filters, controls.page);
  const emptyState = resolveReportEmptyState(metadata?.totalItems, controls.isFiltered);
  const activeFilterChips = getActiveReportFilterChips(
    controls.filters,
    programOptionsQuery.data?.data ?? [],
  );
  const trackedControls = useMemo(
    () => ({
      ...controls,
      setProgram: (value: string) => {
        const changed = controls.setProgram(value);
        if (changed) {
          trackMyReportsEvent({
            name: 'my_reports_filter_changed',
            properties: { filter: 'program', value: null },
          });
        }
        return changed;
      },
      setSeverity: (value: string) => {
        const changed = controls.setSeverity(value);
        if (changed) {
          trackMyReportsEvent({
            name: 'my_reports_filter_changed',
            properties: {
              filter: 'severity',
              value: SEVERITY_OPTIONS.find((severity) => severity === value) ?? null,
            },
          });
        }
        return changed;
      },
      setStatus: (value: string) => {
        const changed = controls.setStatus(value);
        if (changed) {
          trackMyReportsEvent({
            name: 'my_reports_filter_changed',
            properties: {
              filter: 'status',
              value: REPORT_STATUS_OPTIONS.find((status) => status === value) ?? null,
            },
          });
        }
        return changed;
      },
      clearAll: () => {
        const changed = controls.clearAll();
        if (changed) {
          trackMyReportsEvent({
            name: 'my_reports_filter_changed',
            properties: { filter: 'all', value: null },
          });
        }
        return changed;
      },
    }),
    [controls],
  );

  useEffect(() => {
    if (metadata === undefined) return;

    const snapshot = `${String(metadata.page)}:${String(metadata.totalItems)}`;
    if (lastViewedSnapshot.current === snapshot) return;
    lastViewedSnapshot.current = snapshot;
    trackMyReportsEvent({
      name: 'my_reports_viewed',
      properties: { page: metadata.page, resultCount: metadata.totalItems },
    });
  }, [metadata]);

  useEffect(() => {
    if (accessFailure === null) return;

    // `keepPreviousData` may still hold the prior page when a token expires. Remove the entire
    // authenticated namespace before navigating so those rows cannot flash on this or a later
    // account's screen.
    void queryClient.cancelQueries({ queryKey: queryKeys.private });
    queryClient.removeQueries({ queryKey: queryKeys.private });
    router.replace(reportAccessDestination(accessFailure));
  }, [accessFailure, queryClient, router]);

  const changePage = (page: number) => {
    trackMyReportsEvent({
      name: 'my_reports_page_changed',
      properties: { page, resultCount: metadata?.totalItems ?? 0 },
    });
    controls.setPage(page);
  };

  return (
    <div className="flex flex-col gap-xl">
      <ReportPageHeader
        onBrowsePrograms={() =>
          trackMyReportsEvent({
            name: 'my_reports_browse_programs_clicked',
            properties: {},
          })
        }
      />

      {summaryQuery.isPending ? (
        <ReportSummarySkeleton />
      ) : summaryQuery.data === undefined ? null : (
        <ReportSummaryMetrics summary={summaryQuery.data.data} />
      )}

      <ReportFilterBar
        controls={trackedControls}
        programOptions={programOptionsQuery.data?.data ?? []}
        programOptionsUnavailable={programOptionsQuery.isPending || programOptionsQuery.isError}
      />
      {programOptionsQuery.isPending ? (
        <p aria-live="polite" className="text-label-sm text-text-muted" role="status">
          Loading program options…
        </p>
      ) : programOptionsQuery.isError ? (
        <p className="text-label-sm text-error" role="status">
          Program filter is temporarily unavailable. Other filters still work.
        </p>
      ) : query.isFetching && !query.isPending ? (
        <p aria-live="polite" className="text-label-sm text-text-muted" role="status">
          Updating reports…
        </p>
      ) : null}

      {accessFailure !== null ? (
        <ReportStateBlock
          detail={
            accessFailure === 'unauthorized'
              ? 'Redirecting you to sign in again.'
              : 'Redirecting you to the access-denied page.'
          }
          title={
            accessFailure === 'unauthorized'
              ? 'Your session has ended'
              : 'This workspace isn’t available'
          }
          tone="error"
        />
      ) : query.isPending ? (
        <ReportListSkeleton />
      ) : isInitialError ? (
        <ReportStateBlock
          action={
            <Button
              onClick={() => {
                trackMyReportsEvent({
                  name: 'my_reports_retry_clicked',
                  properties: { page: controls.page },
                });
                void query.refetch();
              }}
            >
              Try again
            </Button>
          }
          detail="Your filters are still here. Try again in a moment."
          title="We couldn’t load your reports"
          tone="error"
        />
      ) : emptyState === 'filtered' ? (
        <ReportFilteredEmptyState
          chips={activeFilterChips}
          onClearFilters={trackedControls.clearAll}
        />
      ) : emptyState === 'account' ? (
        <ReportAccountEmptyState
          onBrowsePrograms={() =>
            trackMyReportsEvent({
              name: 'my_reports_browse_programs_clicked',
              properties: {},
            })
          }
        />
      ) : (
        <>
          <NeedsInformationAlert reports={reports} status={controls.filters.status} />
          <ReportTable
            actionLabel="Open"
            caption="Your private reports, with severity, review status, reward and last update."
            {...(controls.filters.status === 'needs_information'
              ? { heading: 'Action required' }
              : {})}
            hrefFor={(report) => reportDetailHref(report.id, returnTo)}
            onOpen={(report) => trackMyReportsEvent(myReportsRowOpenedEvent(report))}
            privacyDescription="Private to you"
            reports={reports}
            sortDescription="Newest submitted first"
          />
          <ReportCardList
            actionLabel="Open"
            hrefFor={(report) => reportDetailHref(report.id, returnTo)}
            onOpen={(report) => trackMyReportsEvent(myReportsRowOpenedEvent(report))}
            reports={reports}
          />

          {metadata === undefined ? null : (
            <ReportPagination
              disabled={query.isFetching}
              metadata={metadata}
              onPageChange={changePage}
            />
          )}

          {query.isError ? (
            <p className="text-body-sm text-error" role="alert">
              This page could not be refreshed. The reports already listed are unaffected.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
