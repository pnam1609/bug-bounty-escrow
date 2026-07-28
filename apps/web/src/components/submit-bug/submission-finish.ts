import type { ReportResponse } from '@bug-bounty-escrow/shared';

import { clearDraft } from './submit-bug-model';
import { queryKeys } from '@/lib/query-keys';

export interface SubmissionQueryCache {
  invalidateQueries(options: { readonly queryKey: readonly unknown[] }): Promise<unknown>;
  setQueryData(queryKey: readonly unknown[], data: ReportResponse): void;
}

export interface SubmissionRouter {
  replace(href: string): void;
}

export interface FinishSubmittedReportInput {
  readonly principalId: string;
  readonly draftKey: string;
  readonly queryClient: SubmissionQueryCache;
  readonly report: ReportResponse;
  readonly router: SubmissionRouter;
}

/**
 * Completes the successful create/upload path in one ordered operation.
 *
 * The detail route is replaced only after the local draft is gone, the exact create response is
 * cached under the report key, and report lists are invalidated. Keeping this outside the React
 * component makes the no-optimistic-redirect contract directly testable.
 */
export async function finishSubmittedReport({
  principalId,
  draftKey,
  queryClient,
  report,
  router,
}: FinishSubmittedReportInput): Promise<void> {
  const reportId = report.data.id;

  clearDraft(draftKey);
  queryClient.setQueryData(queryKeys.report(principalId, reportId), report);
  await queryClient.invalidateQueries({ queryKey: queryKeys.reportsRoot(principalId) });
  router.replace(`/reports/${reportId}`);
}
