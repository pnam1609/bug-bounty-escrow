'use client';

import { reportResponseSchema, type ReportResponse } from '@bug-bounty-escrow/shared';
import { Button, Callout } from '@bug-bounty-escrow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

interface ResubmissionQueryCache {
  invalidateQueries(options: { readonly queryKey: readonly unknown[] }): Promise<unknown>;
  setQueryData(queryKey: readonly unknown[], data: ReportResponse): void;
}

export const RESUBMIT_REPORT_BODY = Object.freeze({ resubmit: true as const });

export function resubmitReportPath(reportId: string): string {
  return `/api/reports/${encodeURIComponent(reportId)}`;
}

/**
 * The filtered My Reports query and the summary share the `reports` prefix. Waiting for this
 * invalidation means returning to `status=needs_information` cannot keep the just-resubmitted row
 * from stale cache, while the exact detail response updates immediately.
 */
export async function finishResubmittedReport(
  queryClient: ResubmissionQueryCache,
  principalId: string,
  report: ReportResponse,
): Promise<void> {
  queryClient.setQueryData(queryKeys.report(principalId, report.data.id), report);
  await queryClient.invalidateQueries({ queryKey: queryKeys.reportsRoot(principalId) });
}

export function ResubmitReportAction({ reportId }: { readonly reportId: string }) {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      apiRequest(resubmitReportPath(reportId), reportResponseSchema, {
        body: RESUBMIT_REPORT_BODY,
        method: 'PATCH',
        token: session?.access_token,
      }),
    onSuccess: (report) =>
      finishResubmittedReport(queryClient, session?.user.id ?? 'no-session', report),
  });

  return (
    <div className="flex flex-col items-start gap-md">
      <Button
        disabled={mutation.isPending}
        onClick={() => mutation.mutate()}
        type="button"
        variant="secondary"
      >
        {mutation.isPending ? 'Resubmitting…' : 'Resubmit report'}
      </Button>
      {mutation.isError ? (
        <Callout title="The report was not resubmitted" variant="danger">
          Your response is still private and unchanged. Try again when you are ready.
        </Callout>
      ) : null}
    </div>
  );
}
