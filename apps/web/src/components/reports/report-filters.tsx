'use client';

import type { Severity } from '@bug-bounty-escrow/shared';
import {
  Button,
  Field,
  REPORT_STATUS_LABELS,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@bug-bounty-escrow/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useId, useMemo } from 'react';

import {
  REPORT_STATUS_OPTIONS,
  SEVERITY_LABELS,
  SEVERITY_OPTIONS,
  type ReportStatus,
} from './report-format';

/*
 * No Figma source — the filter row above both report lists.
 *
 * `GET /api/reports` accepts one `status` and one `severity`, so the control is a pair of single
 * selects rather than a multi-select that would have to fake an OR the server cannot express.
 *
 * Filters live in the URL the same way the bounty table's do: the query key changes with them, so
 * React Query discards the cached pages and restarts at page 1 without any extra bookkeeping, and
 * a filtered list stays shareable and survives Back.
 */

/** Radix reserves the empty string, so "no filter" needs a sentinel of its own. */
const ANY = 'any';

export interface ReportFilters {
  readonly status: ReportStatus | undefined;
  readonly severity: Severity | undefined;
}

export interface ReportFilterControls {
  readonly filters: ReportFilters;
  readonly isFiltered: boolean;
  readonly setStatus: (value: string) => void;
  readonly setSeverity: (value: string) => void;
  readonly clearAll: () => void;
}

function readStatus(raw: string | null): ReportStatus | undefined {
  return REPORT_STATUS_OPTIONS.find((status) => status === raw);
}

function readSeverity(raw: string | null): Severity | undefined {
  return SEVERITY_OPTIONS.find((severity) => severity === raw);
}

export function useReportFilters(): ReportFilterControls {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const status = readStatus(searchParams.get('status'));
  const severity = readSeverity(searchParams.get('severity'));

  const apply = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());

      if (value === ANY) {
        params.delete(key);
      } else {
        params.set(key, value);
      }

      const query = params.toString();
      router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const clearAll = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [pathname, router]);

  return useMemo(
    () => ({
      filters: { status, severity },
      isFiltered: status !== undefined || severity !== undefined,
      setStatus: (value: string) => apply('status', value),
      setSeverity: (value: string) => apply('severity', value),
      clearAll,
    }),
    [apply, clearAll, severity, status],
  );
}

/** Query string for `GET /api/reports`, page included. */
export function toReportSearchParams(filters: ReportFilters, page: number, limit: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });

  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.severity !== undefined) params.set('severity', filters.severity);

  return params.toString();
}

/** Plain object so the React Query key is stable and readable in the devtools. */
export function toReportQueryKey(
  filters: ReportFilters,
  scope: string,
): Readonly<Record<string, unknown>> {
  return { scope, status: filters.status ?? null, severity: filters.severity ?? null };
}

export function ReportFilterBar({ controls }: { readonly controls: ReportFilterControls }) {
  const { clearAll, filters, isFiltered, setSeverity, setStatus } = controls;
  const prefix = useId();
  // A Radix Select root is not a DOM node, so `Field` cannot inject the id into it. The id is set
  // on the trigger instead and handed to `Field` as `htmlFor`, which is what the label points at.
  const statusId = `${prefix}-status`;
  const severityId = `${prefix}-severity`;

  return (
    <div className="flex flex-col gap-lg sm:flex-row sm:items-end">
      <Field className="sm:max-w-56" htmlFor={statusId} label="Status">
        <Select onValueChange={setStatus} value={filters.status ?? ANY}>
          <SelectTrigger id={statusId} size="lg">
            <SelectValue placeholder="Any status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any status</SelectItem>
            {REPORT_STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {REPORT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field className="sm:max-w-56" htmlFor={severityId} label="Severity">
        <Select onValueChange={setSeverity} value={filters.severity ?? ANY}>
          <SelectTrigger id={severityId} size="lg">
            <SelectValue placeholder="Any severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any severity</SelectItem>
            {SEVERITY_OPTIONS.map((severity) => (
              <SelectItem key={severity} value={severity}>
                {SEVERITY_LABELS[severity]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {isFiltered ? (
        <Button className="sm:mb-px" onClick={clearAll} size="lg" variant="ghost">
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
