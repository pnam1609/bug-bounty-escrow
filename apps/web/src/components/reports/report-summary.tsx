import type { ResearcherReportSummary } from '@bug-bounty-escrow/shared';
import { Button } from '@bug-bounty-escrow/ui';
import Link from 'next/link';

const METRICS = Object.freeze([
  {
    key: 'allReports',
    label: 'All reports',
    dotClassName: 'bg-primary',
  },
  {
    key: 'needsInformation',
    label: 'Needs information',
    dotClassName: 'bg-medium',
  },
  {
    key: 'underReview',
    label: 'Under review',
    dotClassName: 'bg-informational',
  },
  {
    key: 'rewardsPaid',
    label: 'Rewards paid · USDC',
    dotClassName: 'bg-success',
  },
] as const);

function formatRewardsPaid(value: string): string {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : value;
}

export function ReportPageHeader() {
  return (
    <header className="flex flex-col gap-lg md:flex-row md:items-end md:justify-between">
      <div className="flex max-w-3xl flex-col gap-sm">
        <p className="text-label-md uppercase text-primary">Researcher workspace</p>
        <h1 className="text-h1 text-text">My reports</h1>
        <p className="text-body text-text-muted">
          Track private submissions, reviewer decisions, and reward progress.
        </p>
      </div>
      <Button asChild className="w-fit" variant="secondary">
        <Link href="/programs">Browse programs</Link>
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
          className="flex min-w-0 flex-col gap-lg rounded-lg border border-border bg-surface p-lg shadow-subtle"
          key={metric.key}
        >
          <dt className="flex items-center gap-sm text-label-sm uppercase text-text-muted">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${metric.dotClassName}`}
            />
            {metric.label}
          </dt>
          <dd className="text-h2 text-text">{values[metric.key]}</dd>
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
          className="flex flex-col gap-lg rounded-lg border border-border bg-surface p-lg"
          key={metric.key}
        >
          <span className="h-4 w-32 animate-pulse rounded-sm bg-surface-raised motion-reduce:animate-none" />
          <span className="h-8 w-20 animate-pulse rounded-sm bg-surface-raised motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}
