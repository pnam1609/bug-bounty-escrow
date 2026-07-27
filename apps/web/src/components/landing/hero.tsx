import { BountyCard, Button, StatusBadge } from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LANDING_CONTAINER } from './section';

/* Figma "Hero" (node 55:19) — copy column 620px, escrow proof panel 540px, 72px apart. */

const TRUST_PROOF: readonly string[] = ['Funded upfront', 'Human validated', 'Settled on-chain'];

/** The two panel tiles under the card — nodes 55:69 and 55:72. */
const ESCROW_METRICS: readonly { readonly label: string; readonly value: string }[] = [
  { label: 'Pool coverage', value: '100%' },
  { label: 'USDC settlement', value: '< 20 sec' },
];

export function LandingHero(): ReactNode {
  return (
    <section aria-labelledby="hero-heading" className="bg-background py-2xl lg:py-[64px]">
      <div
        className={`${LANDING_CONTAINER} flex flex-col items-start gap-2xl lg:flex-row lg:items-center lg:justify-center lg:gap-[72px]`}
      >
        <div className="flex w-full max-w-[620px] min-w-0 flex-col items-start gap-xl">
          <p className="inline-flex items-center rounded-full border border-border-brand bg-ambient px-md py-sm text-label-md uppercase text-primary">
            Arc Testnet · USDC escrow
          </p>

          {/*
           * Display/XL (48/56/-1) is the one type style on this frame with no counterpart in
           * theme.css, whose scale tops out at `text-h1` (32/40/-0.5). H1 carries the page below
           * `lg`; the frame figure only applies at the width it was drawn for.
           */}
          <h1
            className="text-h1 text-balance text-text lg:text-[48px] lg:leading-[56px] lg:tracking-[-1px]"
            id="hero-heading"
          >
            <span className="block">Hunt critical bugs.</span>
            <span className="block">Get paid with certainty.</span>
          </h1>

          <p className="max-w-[560px] text-body text-text-muted">
            Bounty programs with rewards locked before the first report. Researchers get transparent
            pools and direct USDC settlement; owners only pay validated findings.
          </p>

          <div className="flex flex-wrap items-center gap-md">
            <Button asChild size="lg" variant="primary">
              <Link href="/programs">Explore bounties</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/owner/programs/new">Launch a program</Link>
            </Button>
          </div>

          {/* Figma sets these 20px apart, which the 4/8/12/16/24 spacing scale does not cover. */}
          <ul className="flex flex-wrap items-center gap-x-[20px] gap-y-sm">
            {TRUST_PROOF.map((proof) => (
              <li
                className="inline-flex items-center gap-xs text-label-md text-text-muted"
                key={proof}
              >
                <span aria-hidden="true">✓</span>
                {proof}
              </li>
            ))}
          </ul>
        </div>

        {/*
         * The proof panel is illustrative, not live data — the card carries no link so the hero
         * has exactly two actions. Its heading is real, which keeps the card's own `h3` correctly
         * nested under an `h2` instead of jumping a level from the page `h1`.
         */}
        <section
          aria-labelledby="live-escrow-heading"
          className="flex w-full max-w-[540px] min-w-0 flex-col gap-lg rounded-lg border border-border bg-surface-raised p-xl shadow-elevated"
          id="live-escrow"
        >
          <div className="flex flex-wrap items-center justify-between gap-md">
            <h2
              className="inline-flex items-center gap-sm text-label-md uppercase text-escrow"
              id="live-escrow-heading"
            >
              <span aria-hidden="true" className="size-sm shrink-0 rounded-full bg-escrow" />
              Live escrow
            </h2>
            <StatusBadge status="paid" />
          </div>

          <BountyCard
            assetSummary="Smart contracts · Ethereum"
            className="w-full max-w-[392px]"
            escrowPool="185,000 USDC"
            maxBounty="$250K"
            programName="Aegis Protocol"
            severity="critical"
            tags={['Solidity', 'Ethereum']}
          />

          <dl className="grid gap-md sm:grid-cols-2">
            {ESCROW_METRICS.map((metric) => (
              <div
                className="flex flex-col gap-xs rounded-md border border-border bg-surface px-lg py-md"
                key={metric.label}
              >
                <dt className="text-label-sm uppercase text-text-muted">{metric.label}</dt>
                <dd className="text-h3 text-text">{metric.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </section>
  );
}
