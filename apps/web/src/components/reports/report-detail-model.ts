import type { ReportFilters } from './report-filters';

const REPORTS_PATH = '/reports';

export function reportListHref(filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.severity !== undefined) params.set('severity', filters.severity);

  const query = params.toString();
  return query === '' ? REPORTS_PATH : `${REPORTS_PATH}?${query}`;
}

export function reportDetailHref(reportId: string, returnTo: string): string {
  return `/reports/${encodeURIComponent(reportId)}?returnTo=${encodeURIComponent(returnTo)}`;
}

/** Only a My Reports list URL can control the detail page's back destination. */
export function safeReportListReturnTo(requested: string | null): string {
  if (requested === null || requested === REPORTS_PATH) return REPORTS_PATH;

  try {
    const parsed = new URL(requested, 'https://internal.invalid');
    if (
      parsed.origin !== 'https://internal.invalid' ||
      parsed.pathname !== REPORTS_PATH ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      return REPORTS_PATH;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return REPORTS_PATH;
  }
}
