import { BountyCard, Button, type BountyCardProps } from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LANDING_CONTAINER, SectionIntro } from './section';

/*
 * Figma "Featured Programs" (node 57:34): three 392px cards, 24px apart, under a section header
 * whose action sits on the baseline of the supporting line.
 *
 * The landing page is public and static, so nothing here is fetched. These three are the synthetic
 * programs drawn in the frame; every card links to the real `/programs` index rather than to a
 * detail route that does not exist for a made-up id.
 */
const FEATURED: readonly Pick<
  BountyCardProps,
  'assetSummary' | 'escrowPool' | 'maxBounty' | 'programName' | 'severity' | 'tags'
>[] = [
  {
    assetSummary: 'Smart contracts · Ethereum',
    escrowPool: '185,000 USDC',
    maxBounty: '$250K',
    programName: 'Aegis Protocol',
    severity: 'critical',
    tags: ['Solidity', 'Ethereum'],
  },
  {
    assetSummary: 'Smart contracts · Ethereum',
    escrowPool: '92,500 USDC',
    maxBounty: '$120K',
    programName: 'Nova Bridge',
    severity: 'high',
    tags: ['Solidity', 'Ethereum'],
  },
  {
    assetSummary: 'Smart contracts · Ethereum',
    escrowPool: '66,000 USDC',
    maxBounty: '$75K',
    programName: 'Orbit Lend',
    severity: 'medium',
    tags: ['Solidity', 'Ethereum'],
  },
];

export function LandingFeaturedPrograms(): ReactNode {
  return (
    <section
      aria-labelledby="featured-programs-heading"
      className="bg-background py-3xl lg:py-[72px]"
      id="featured-programs"
    >
      <div className={`${LANDING_CONTAINER} flex flex-col gap-2xl`}>
        <div className="flex flex-col items-start gap-xl lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-[700px]">
            <SectionIntro
              align="start"
              eyebrow="Featured bounties"
              headingId="featured-programs-heading"
              subtitle="Every listed pool is transparent and funded before submissions open."
              title="Funded programs, ready for your next finding"
              tone="primary"
            />
          </div>
          <Button asChild size="md" variant="secondary">
            <Link href="/programs">View all programs</Link>
          </Button>
        </div>

        <ul className="grid gap-xl sm:grid-cols-2 lg:grid-cols-3">
          {FEATURED.map((program) => (
            <li className="flex" key={program.programName}>
              <BountyCard
                {...program}
                actionLabel={`${program.programName} — browse funded programs`}
                className="w-full"
                escrowFunded
                href="/programs"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
