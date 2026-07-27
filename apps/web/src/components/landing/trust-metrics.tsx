import type { ReactNode } from 'react';

import { LANDING_CONTAINER } from './section';

/*
 * Figma "Trust Metrics" (node 56:34): a 176px band on `surface` between two hairlines, four
 * 260px columns 48px apart. Value over label, so the pairs are written label-first and flipped
 * with `flex-col-reverse` — the DOM keeps the reading order a screen reader wants.
 */
const METRICS: readonly { readonly label: string; readonly value: string }[] = [
  { label: 'Rewards protected', value: '2.4M USDC' },
  { label: 'Active programs', value: '48' },
  { label: 'Avg. settlement', value: '< 20 sec' },
  { label: 'Verifiable payouts', value: 'On-chain' },
];

export function LandingTrustMetrics(): ReactNode {
  return (
    <section
      aria-label="Platform metrics"
      className="border-y border-border bg-surface py-2xl lg:py-[44px]"
      id="trust-metrics"
    >
      <dl
        className={`${LANDING_CONTAINER} grid grid-cols-2 gap-xl md:grid-cols-4 lg:justify-items-center lg:gap-3xl`}
      >
        {METRICS.map((metric) => (
          <div
            className="flex flex-col-reverse items-center justify-center gap-sm text-center lg:w-[260px]"
            key={metric.label}
          >
            <dt className="text-label-md uppercase text-text-muted">{metric.label}</dt>
            <dd className="text-h1 text-text">{metric.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
