import { Card } from '@bug-bounty-escrow/ui';
import type { ReactNode } from 'react';

import { LANDING_CONTAINER, SectionIntro } from './section';

/*
 * Figma "Why BountyEscrow" (node 58:113): three 432px value cards, 24px apart, on `background`.
 *
 * Each eyebrow carries its own semantic hue — mint for the escrow guarantee, USDC blue for the
 * private surface, violet for the verifiable payout — and each is paired with its own words, so
 * the meaning never rests on the colour.
 */
const VALUES: readonly {
  readonly body: string;
  readonly eyebrow: string;
  readonly tone: string;
  readonly title: string;
}[] = [
  {
    eyebrow: '01 / Guaranteed',
    tone: 'text-escrow',
    title: 'Rewards that already exist',
    body: 'Every public program shows an escrow pool funded before researchers begin.',
  },
  {
    eyebrow: '02 / Private',
    tone: 'text-usdc',
    title: 'Reports stay confidential',
    body: 'PoC, attachments and collaboration remain permissioned and off-chain.',
  },
  {
    eyebrow: '03 / Verifiable',
    tone: 'text-primary',
    title: 'Payouts anyone can verify',
    body: 'USDC settlement is recorded on-chain with a transaction researchers can confirm.',
  },
];

export function LandingWhyBountyEscrow(): ReactNode {
  return (
    <section
      aria-labelledby="why-bountyescrow-heading"
      className="bg-background py-3xl lg:py-[80px]"
      id="why-bountyescrow"
    >
      <div className={`${LANDING_CONTAINER} flex flex-col items-center gap-2xl lg:gap-[40px]`}>
        <SectionIntro
          eyebrow="Why BountyEscrow"
          headingId="why-bountyescrow-heading"
          subtitle="The guarantees researchers need, with the controls owners expect."
          title="Trust designed into every bounty"
          tone="primary"
        />

        <ul className="grid w-full gap-xl lg:grid-cols-3">
          {VALUES.map((value) => (
            <li className="flex" key={value.title}>
              <Card className="w-full" padding="md" variant="default">
                <p className={`text-label-md uppercase ${value.tone}`}>{value.eyebrow}</p>
                <h3 className="text-h2 text-balance text-text">{value.title}</h3>
                <p className="text-body-sm text-text-muted">{value.body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
