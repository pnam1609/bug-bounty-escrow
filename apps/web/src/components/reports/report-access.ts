import { ApiClientError } from '@/lib/api-client';

export type ReportAccessFailure = 'forbidden' | 'unauthorized' | null;

export const REPORTS_LOGIN_HREF = '/login?returnTo=%2Freports';
export const REPORTS_ACCESS_DENIED_HREF = '/access-denied?from=%2Freports';

/**
 * Authorization is decided from HTTP status only. Error codes/messages are deliberately ignored:
 * server details never enter UI copy, analytics or logs.
 */
export function getReportAccessFailure(
  ...errors: readonly unknown[]
): ReportAccessFailure {
  for (const error of errors) {
    if (!(error instanceof ApiClientError)) continue;
    if (error.status === 401) return 'unauthorized';
    if (error.status === 403) return 'forbidden';
  }
  return null;
}

export function reportAccessDestination(failure: Exclude<ReportAccessFailure, null>): string {
  return failure === 'unauthorized' ? REPORTS_LOGIN_HREF : REPORTS_ACCESS_DENIED_HREF;
}
