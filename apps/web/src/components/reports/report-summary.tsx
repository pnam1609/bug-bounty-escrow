import type { ResearcherReportSummary } from '@bug-bounty-escrow/shared';
import { Button } from '@bug-bounty-escrow/ui';
import Link from 'next/link';

const METRICS = Object.freeze([
  {
    key: 'allReports',
    label: 'All reports',
    dotClassName: 'bg-informational',
  },
  {
    key: 'needsInformation',
    label: 'Needs information',
    dotClassName: 'bg-medium',
  },
  {
    key: 'underReview',
    label: 'Under review',
    dotClassName: 'bg-primary',
  },
  {
    key: 'rewardsPaid',
    label: 'Rewards paid · USDC',
    dotClassName: 'bg-success',
  },
] as const);

function formatRewardsPaid(value: string): string {
  const [whole = '0', fraction = ''] = value.split('.');
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const visibleFraction = fraction.replace(/0+$/, '');

  return visibleFraction === '' ? groupedWhole : `${groupedWhole}.${visibleFraction}`;
}

export function ReportPageHeader({ onBrowsePrograms }: { readonly onBrowsePrograms?: () => void }) {
  return (
    <header className="flex flex-col gap-lg md:flex-row md:items-end md:justify-between">
      <div className="flex max-w-3xl flex-col gap-sm">
        <p className="text-label-md uppercase text-primary">Researcher workspace</p>
        <h1 className="text-h1 text-text">My reports</h1>
        <p className="text-body text-text-muted">
          Track private submissions, reviewer decisions, and reward progress.
        </p>
      </div>
      <Button asChild className="w-fit">
        <Link
          href="/programs"
          {...(onBrowsePrograms === undefined ? {} : { onClick: onBrowsePrograms })}
        >
          Browse programs
        </Link>
      </Button>
    </header>
  );
}

export function ReportSummaryMetrics({ summary }: { readonly summary: ResearcherReportSummary }) {
  const values = {
    allReports: String(summary.allReports),
    needsInformation: String(summary.needsInformation),
    underReview: String(summary.underReview),
    rewardsPaid: formatRewardsPaid(summary.rewardsPaid),
  } as const;

  return (
    <dl
      aria-label={`Report summary calculated ${summary.calculatedAt}`}
      className="grid gap-md sm:grid-cols-2 xl:grid-cols-4"
    >
      {METRICS.map((metric) => (
        <div
          className="flex min-w-0 flex-col gap-sm rounded-lg border border-border bg-surface-raised p-lg shadow-subtle"
          key={metric.key}
        >
          <dt className="order-2 text-body-sm text-text-muted">{metric.label}</dt>
          <dd className="order-1 flex items-center gap-sm text-h2 text-text">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${metric.dotClassName}`}
            />
            {values[metric.key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ReportSummarySkeleton() {
  return (
    <div
      aria-label="Loading report summary"
      className="grid gap-md sm:grid-cols-2 xl:grid-cols-4"
      role="status"
    >
      {METRICS.map((metric) => (
        <div
          aria-hidden="true"
          className="flex flex-col gap-sm rounded-lg border border-border bg-surface-raised p-lg"
          key={metric.key}
        >
          <span className="h-4 w-32 animate-pulse rounded-sm bg-ambient motion-reduce:animate-none" />
          <span className="h-8 w-20 animate-pulse rounded-sm bg-ambient motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}
