import { Button } from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LANDING_CONTAINER } from './section';

/*
 * Figma "Final CTA" (node 58:131): a 1344x300 panel on `ambient` with a brand hairline and the
 * elevated shadow, centred inside the 48px page inset. The panel is the content column itself,
 * so it takes the shared container rather than sitting inside one.
 */
export function LandingFinalCta(): ReactNode {
  return (
    <section
      aria-labelledby="final-cta-heading"
      className="bg-background py-3xl lg:py-[60px]"
      id="final-cta"
    >
      <div className={LANDING_CONTAINER}>
        <div className="flex flex-col items-center justify-center gap-lg rounded-lg border border-border-brand bg-ambient px-xl py-3xl text-center shadow-elevated sm:px-2xl lg:px-3xl lg:py-[60px]">
          <p className="text-label-md uppercase text-primary">Security, settled</p>
          <h2 className="text-h1 text-balance text-text" id="final-cta-heading">
            Turn security work into verified outcomes
          </h2>
          <p className="text-body text-balance text-text-muted">
            Launch a funded program or find the next critical bounty.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-md">
            <Button asChild size="lg" variant="primary">
              <Link href="/programs">Explore bounties</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/owner/programs/new">Create a program</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
