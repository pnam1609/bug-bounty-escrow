import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthCardSkeleton, AuthLayout } from '@/components/auth/auth-layout';
import { CheckEmailCard } from '@/components/auth/check-email-card';

/**
 * AUTH-03 — Check email (§5). Same journey as `/register`, so the brand panel repeats the
 * `Layout / Sign Up / Desktop` (61:116) copy rather than introducing a new frame mid-flow.
 */

export const metadata: Metadata = {
  title: 'Check your email · BountyEscrow',
  description: 'Open the confirmation link we sent you to activate your BountyEscrow account.',
};

const TRUST_BENEFITS = Object.freeze([
  'Rewards funded before submissions open',
  'Vulnerability reports remain private',
  'Human-reviewed, on-chain USDC payouts',
]);

export default function CheckEmailPage() {
  return (
    <AuthLayout
      aside={
        <ul className="flex flex-col gap-md">
          {TRUST_BENEFITS.map((benefit) => (
            <li className="flex items-start gap-sm text-body-sm text-escrow" key={benefit}>
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {benefit}
            </li>
          ))}
        </ul>
      }
      eyebrow="JOIN THE NETWORK"
      footnote={
        <p className="text-label-sm text-text-muted">
          PRIVATE REPORTS · HUMAN VALIDATION · USDC
        </p>
      }
      headline="Build trust into every bounty."
      lede="One account for transparent programs, private collaboration and verified settlement."
    >
      {/* `CheckEmailCard` reads `returnTo` with `useSearchParams`, which Next requires a boundary for. */}
      <Suspense fallback={<AuthCardSkeleton />}>
        <CheckEmailCard />
      </Suspense>
    </AuthLayout>
  );
}
