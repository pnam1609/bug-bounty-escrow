import { Card } from '@bug-bounty-escrow/ui';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthCardSkeleton, AuthLayout, NetworkStatus } from '@/components/auth/auth-layout';
import { SignInForm } from '@/components/auth/sign-in-form';

/** AUTH-04 — Figma `Layout / Sign In / Desktop` (61:115). */

export const metadata: Metadata = {
  title: 'Sign in · BountyEscrow',
  description: 'Sign in to manage reports, rewards and funded programs.',
};

export default function LoginPage() {
  return (
    <AuthLayout
      aside={
        <Card className="gap-xs px-xl py-lg" variant="subtle">
          <p className="text-label-sm text-text-muted">REWARDS PROTECTED</p>
          <p className="text-h3 text-escrow">2.4M USDC in funded pools</p>
        </Card>
      }
      eyebrow="WELCOME BACK"
      footnote={<NetworkStatus />}
      headline="Your work, paid with certainty."
      lede="Return to private reports, transparent reward pools and on-chain USDC settlement."
    >
      {/* `SignInForm` reads `returnTo` with `useSearchParams`, which Next requires a boundary for. */}
      <Suspense fallback={<AuthCardSkeleton />}>
        <SignInForm />
      </Suspense>
    </AuthLayout>
  );
}
