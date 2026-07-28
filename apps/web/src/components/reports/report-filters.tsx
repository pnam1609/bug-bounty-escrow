'use client';

import {
  uuidSchema,
  type ReportProgramFilterOption,
  type Severity,
} from '@bug-bounty-escrow/shared';
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
 * Figma `282:4379` — the filter row above both report lists.
 *
 * `GET /api/reports` accepts one program, one status and one severity, so every control is a single
 * select rather than a multi-select that would have to fake an OR the server cannot express.
 *
 * Filters live in the URL the same way the bounty table's do: the query key changes with them, so
 * React Query discards the cached pages and restarts at page 1 without any extra bookkeeping, and
 * a filtered list stays shareable and survives Back.
 */

/** Radix reserves the empty string, so "no filter" needs a sentinel of its own. */
const ANY = 'any';
export const REPORT_PROGRAM_FILTER_OPTIONS_PATH = '/api/reports/filter-options/programs';
export type ReportFilterKey = 'programId' | 'severity' | 'status';

export interface ReportFilters {
  readonly programId?: string | undefined;
  readonly status?: ReportStatus | undefined;
  readonly severity?: Severity | undefined;
}

export interface ReportFilterControls {
  readonly filters: ReportFilters;
  readonly isFiltered: boolean;
  readonly page: number;
  readonly setProgram: (value: string) => boolean;
  readonly setStatus: (value: string) => boolean;
  readonly setSeverity: (value: string) => boolean;
  readonly setPage: (page: number) => boolean;
  readonly clearAll: () => boolean;
}

function readProgramId(raw: string | null): string | undefined {
  const parsed = uuidSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

function readStatus(raw: string | null): ReportStatus | undefined {
  return REPORT_STATUS_OPTIONS.find((status) => status === raw);
}

function readSeverity(raw: string | null): Severity | undefined {
  return SEVERITY_OPTIONS.find((severity) => severity === raw);
}

function readPage(raw: string | null): number {
  if (raw === null || !/^[1-9]\d*$/u.test(raw)) return 1;

  const page = Number(raw);
  return Number.isSafeInteger(page) ? page : 1;
}

function reportPath(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  return query === '' ? pathname : `${pathname}?${query}`;
}

export function reportFilterNavigation(
  pathname: string,
  current: URLSearchParams,
  key: ReportFilterKey,
  value: string,
): string | null {
  const allowed =
    value === ANY ||
    (key === 'programId'
      ? uuidSchema.safeParse(value).success
      : key === 'status'
        ? readStatus(value) !== undefined
        : readSeverity(value) !== undefined);
  if (!allowed) return null;

  const params = new URLSearchParams(current);
  if (value === ANY) {
    params.delete(key);
  } else {
    params.set(key, value);
  }
  params.delete('page');

  return params.toString() === current.toString() ? null : reportPath(pathname, params);
}

export function reportPageNavigation(
  pathname: string,
  current: URLSearchParams,
  nextPage: number,
): string | null {
  if (!Number.isSafeInteger(nextPage) || nextPage < 1) return null;

  const params = new URLSearchParams(current);
  if (nextPage === 1) {
    params.delete('page');
  } else {
    params.set('page', String(nextPage));
  }

  return params.toString() === current.toString() ? null : reportPath(pathname, params);
}

export function reportResetNavigation(pathname: string, current: URLSearchParams): string | null {
  return current.size === 0 ? null : pathname;
}

export function reportFilterState(params: Pick<URLSearchParams, 'get'>): {
  readonly filters: ReportFilters;
  readonly page: number;
} {
  return {
    filters: {
      programId: readProgramId(params.get('programId')),
      status: readStatus(params.get('status')),
      severity: readSeverity(params.get('severity')),
    },
    page: readPage(params.get('page')),
  };
}

export function useReportFilters(): ReportFilterControls {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const state = reportFilterState(searchParams);
  const { programId, severity, status } = state.filters;
  const { page } = state;

  const navigate = useCallback(
    (href: string | null): boolean => {
      if (href === null) return false;
      router.replace(href, { scroll: false });
      return true;
    },
    [router],
  );

  const apply = useCallback(
    (key: ReportFilterKey, value: string) => {
      return navigate(
        reportFilterNavigation(pathname, new URLSearchParams(searchParams.toString()), key, value),
      );
    },
    [navigate, pathname, searchParams],
  );

  const clearAll = useCallback(() => {
    return navigate(reportResetNavigation(pathname, new URLSearchParams(searchParams.toString())));
  }, [navigate, pathname, searchParams]);

  const setPage = useCallback(
    (nextPage: number) => {
      return navigate(
        reportPageNavigation(pathname, new URLSearchParams(searchParams.toString()), nextPage),
      );
    },
    [navigate, pathname, searchParams],
  );

  return useMemo(
    () => ({
      filters: { programId, status, severity },
      isFiltered: programId !== undefined || status !== undefined || severity !== undefined,
      page,
      setProgram: (value: string) => apply('programId', value),
      setStatus: (value: string) => apply('status', value),
      setSeverity: (value: string) => apply('severity', value),
      setPage,
      clearAll,
    }),
    [apply, clearAll, page, programId, setPage, severity, status],
  );
}

/** Query string for `GET /api/reports`, page included. */
export function toReportSearchParams(filters: ReportFilters, page: number, limit: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });

  if (filters.programId !== undefined) params.set('programId', filters.programId);
  if (filters.status !== undefined) params.set('status', filters.status);
  if (filters.severity !== undefined) params.set('severity', filters.severity);

  return params.toString();
}

/** Plain object so the React Query key is stable and readable in the devtools. */
export function toReportQueryKey(
  filters: ReportFilters,
  scope: string,
  page?: number,
): Readonly<Record<string, unknown>> {
  return {
    scope,
    programId: filters.programId ?? null,
    status: filters.status ?? null,
    severity: filters.severity ?? null,
    ...(page === undefined ? {} : { page }),
  };
}

export function ReportFilterBar({
  controls,
  programOptions,
  programOptionsUnavailable = false,
}: {
  readonly controls: ReportFilterControls;
  readonly programOptions?: readonly ReportProgramFilterOption[];
  readonly programOptionsUnavailable?: boolean;
}) {
  const { clearAll, filters, isFiltered, page, setProgram, setSeverity, setStatus } = controls;
  const prefix = useId();
  // A Radix Select root is not a DOM node, so `Field` cannot inject the id into it. The id is set
  // on the trigger instead and handed to `Field` as `htmlFor`, which is what the label points at.
  const programId = `${prefix}-program`;
  const statusId = `${prefix}-status`;
  const severityId = `${prefix}-severity`;
  const canReset = isFiltered || page !== 1;

  return (
    <div className="flex flex-col gap-lg sm:flex-row sm:items-end">
      {programOptions === undefined ? null : (
        <Field
          className="sm:w-72"
          disabled={programOptionsUnavailable}
          htmlFor={programId}
          label="Program"
        >
          <Select
            disabled={programOptionsUnavailable}
            onValueChange={setProgram}
            value={filters.programId ?? ANY}
          >
            <SelectTrigger id={programId} size="lg">
              <SelectValue placeholder="All programs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All programs</SelectItem>
              {programOptions.map((program) => (
                <SelectItem key={program.id} value={program.id}>
                  {program.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}

      <Field className="sm:w-64" htmlFor={statusId} label="Status">
        <Select onValueChange={setStatus} value={filters.status ?? ANY}>
          <SelectTrigger id={statusId} size="lg">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All statuses</SelectItem>
            {REPORT_STATUS_OPTIONS.map((status) => (
              <SelectItem key={status} value={status}>
                {REPORT_STATUS_LABELS[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field className="sm:w-60" htmlFor={severityId} label="Severity">
        <Select onValueChange={setSeverity} value={filters.severity ?? ANY}>
          <SelectTrigger id={severityId} size="lg">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>All severities</SelectItem>
            {SEVERITY_OPTIONS.map((severity) => (
              <SelectItem key={severity} value={severity}>
                {SEVERITY_LABELS[severity]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Button
        className="sm:mb-px"
        disabled={!canReset}
        onClick={clearAll}
        size="lg"
        variant="ghost"
      >
        Reset filters
      </Button>
    </div>
  );
}
