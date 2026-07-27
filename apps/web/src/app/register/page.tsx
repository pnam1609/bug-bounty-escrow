import { Check } from 'lucide-react';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthCardSkeleton, AuthLayout } from '@/components/auth/auth-layout';
import { SignUpForm } from '@/components/auth/sign-up-form';

/** AUTH-02 — Figma `Layout / Sign Up / Desktop` (61:116). */

export const metadata: Metadata = {
  title: 'Create an account · BountyEscrow',
  description: 'One account for transparent programs, private collaboration and USDC settlement.',
};

const TRUST_BENEFITS = Object.freeze([
  'Rewards funded before submissions open',
  'Vulnerability reports remain private',
  'Human-reviewed, on-chain USDC payouts',
]);

export default function RegisterPage() {
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
      {/* `SignUpForm` reads `returnTo` with `useSearchParams`, which Next requires a boundary for. */}
      <Suspense fallback={<AuthCardSkeleton />}>
        <SignUpForm />
      </Suspense>
    </AuthLayout>
  );
}
