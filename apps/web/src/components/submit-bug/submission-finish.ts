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
  readonly programId: string;
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
  programId,
  queryClient,
  report,
  router,
}: FinishSubmittedReportInput): Promise<void> {
  const reportId = report.data.id;

  clearDraft(programId);
  queryClient.setQueryData(queryKeys.report(reportId), report);
  await queryClient.invalidateQueries({ queryKey: ['reports'] });
  router.replace(`/reports/${reportId}`);
}
