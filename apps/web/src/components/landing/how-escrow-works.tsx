import { Card } from '@bug-bounty-escrow/ui';
import type { ReactNode } from 'react';

import { LANDING_CONTAINER, SectionIntro } from './section';

/*
 * Figma "How Escrow Works" (node 57:124): four 306px steps, 16px apart, on `surface-raised`
 * between two hairlines. `Card variant="subtle"` is that surface exactly — raised fill, 14px
 * radius, hairline border, 24px padding, 16px stack — so the step is a `Card`, not a new box.
 *
 * Step 03 is the load-bearing one: validation is a person, never the escrow. The escrow only
 * proves the money is there and locked.
 */
const STEPS: readonly { readonly body: string; readonly title: string }[] = [
  {
    title: 'Fund rewards',
    body: 'Owner deploys the escrow and locks USDC before the program goes live.',
  },
  {
    title: 'Submit privately',
    body: 'Researchers share reports, impact and PoC through protected access.',
  },
  {
    title: 'Human validation',
    body: 'Owner or reviewer verifies scope, severity and the approved reward.',
  },
  {
    title: 'Settle on-chain',
    body: 'Escrow releases USDC to the researcher and records the transaction.',
  },
];

export function LandingHowEscrowWorks(): ReactNode {
  return (
    <section
      aria-labelledby="how-escrow-works-heading"
      className="border-y border-border bg-surface py-3xl lg:py-[80px]"
      id="how-escrow-works"
    >
      <div className={`${LANDING_CONTAINER} flex flex-col items-center gap-2xl lg:gap-[40px]`}>
        <SectionIntro
          eyebrow="Guaranteed escrow"
          headingId="how-escrow-works-heading"
          subtitle="Four transparent steps. No hidden balance. No automated payout decisions."
          title="From funded pool to verified payout"
          tone="escrow"
        />

        <ol className="grid w-full gap-lg sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, index) => (
            <li className="flex" key={step.title}>
              <Card className="w-full" padding="md" variant="subtle">
                <p className="text-label-md text-primary">
                  <span className="sr-only">Step </span>
                  {String(index + 1).padStart(2, '0')}
                </p>
                <h3 className="text-h3 text-balance text-text">{step.title}</h3>
                <p className="text-body-sm text-text-muted">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
