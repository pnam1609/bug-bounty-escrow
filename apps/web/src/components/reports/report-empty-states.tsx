'use client';

import type { ReportProgramFilterOption } from '@bug-bounty-escrow/shared';
import { Button, Card, REPORT_STATUS_LABELS } from '@bug-bounty-escrow/ui';
import { FileSearch, FileText } from 'lucide-react';
import Link from 'next/link';

import { SEVERITY_LABELS } from './report-format';
import type { ReportFilters } from './report-filters';

/*
 * Figma `281:1924` — the researcher account-empty state, plus the filtered variant required by
 * the flow doc. The API metadata is the authority for both variants: the length of one requested
 * page cannot prove that the account has never submitted a report.
 */

export type ReportEmptyState = 'account' | 'filtered' | null;

export interface ActiveReportFilterChip {
  readonly id: 'program' | 'severity' | 'status';
  readonly label: string;
}

export function resolveReportEmptyState(
  totalItems: number | undefined,
  isFiltered: boolean,
): ReportEmptyState {
  if (totalItems !== 0) return null;
  return isFiltered ? 'filtered' : 'account';
}

export function getActiveReportFilterChips(
  filters: ReportFilters,
  programOptions: readonly ReportProgramFilterOption[],
): readonly ActiveReportFilterChip[] {
  const chips: ActiveReportFilterChip[] = [];

  if (filters.programId !== undefined) {
    const selectedProgram = programOptions.find((program) => program.id === filters.programId);
    chips.push({
      id: 'program',
      label: `Program: ${selectedProgram?.name ?? 'Selected program'}`,
    });
  }

  if (filters.status !== undefined) {
    chips.push({ id: 'status', label: `Status: ${REPORT_STATUS_LABELS[filters.status]}` });
  }

  if (filters.severity !== undefined) {
    chips.push({ id: 'severity', label: `Severity: ${SEVERITY_LABELS[filters.severity]}` });
  }

  return chips;
}

function DecorativeReportIcon({ variant }: { readonly variant: 'account' | 'filtered' }) {
  const Icon = variant === 'account' ? FileText : FileSearch;

  return (
    <span
      aria-hidden="true"
      className="inline-flex rounded-full border border-border-brand bg-surface-raised p-xl text-text"
    >
      <Icon className="size-xl" />
    </span>
  );
}

const ONBOARDING_STEPS = [
  'Choose a program',
  'Submit a private report',
  'Track review and reward',
] as const;

export function ReportAccountEmptyState({
  onBrowsePrograms,
}: {
  readonly onBrowsePrograms?: () => void;
}) {
  return (
    <div className="flex flex-col gap-xl">
      <Card className="items-center text-center" padding="lg">
        <DecorativeReportIcon variant="account" />
        <div className="flex max-w-2xl flex-col items-center gap-sm">
          <h2 className="text-h2 text-text">No reports yet</h2>
          <p className="text-body-sm text-text-muted">
            Browse an active bounty program and submit a private, reproducible vulnerability
            report. Your submissions will appear here.
          </p>
        </div>

        <Button asChild>
          <Link
            href="/programs"
            {...(onBrowsePrograms === undefined ? {} : { onClick: onBrowsePrograms })}
          >
            Browse programs
          </Link>
        </Button>

        <ol className="grid w-full gap-md text-left sm:grid-cols-3">
          {ONBOARDING_STEPS.map((step, index) => (
            <li key={step}>
              <Card className="h-full gap-sm" padding="md" variant="subtle">
                <span className="text-label-md text-text-muted">{index + 1}</span>
                <span className="text-label-lg text-text">{step}</span>
              </Card>
            </li>
          ))}
        </ol>
      </Card>

      <Card className="flex-row items-start gap-md" padding="md" variant="subtle">
        <span aria-hidden="true" className="mt-xs size-sm shrink-0 rounded-full bg-low" />
        <div className="flex flex-col gap-xs">
          <p className="text-label-lg text-text">Reports are private by default</p>
          <p className="text-body-sm text-text-muted">
            Report content remains participant-only unless a separate disclosure decision is
            published.
          </p>
        </div>
      </Card>
    </div>
  );
}

export function ReportFilteredEmptyState({
  chips,
  onClearFilters,
}: {
  readonly chips: readonly ActiveReportFilterChip[];
  readonly onClearFilters: () => void;
}) {
  return (
    <Card className="items-center text-center" padding="lg">
      <DecorativeReportIcon variant="filtered" />
      <div className="flex max-w-xl flex-col items-center gap-sm">
        <h2 className="text-h2 text-text">No reports match these filters</h2>
        <p className="text-body-sm text-text-muted">
          Try clearing the active filters to see other reports.
        </p>
      </div>

      <ul aria-label="Active filters" className="flex flex-wrap justify-center gap-sm">
        {chips.map((chip) => (
          <li
            className="rounded-full border border-border-brand bg-surface-raised px-lg py-sm text-label-md text-text"
            key={chip.id}
          >
            {chip.label}
          </li>
        ))}
      </ul>

      <Button onClick={onClearFilters} variant="secondary">
        Clear filters
      </Button>
    </Card>
  );
}
