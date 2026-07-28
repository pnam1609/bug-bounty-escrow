import { Card } from '@bug-bounty-escrow/ui';
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuthCardSkeleton, AuthLayout, NetworkStatus } from '@/components/auth/auth-layout';
import { OAuthCallback } from '@/components/auth/oauth-callback';

export const metadata: Metadata = {
  title: 'Completing sign-in · BountyEscrow',
  description: 'Completing Google sign-in and opening your BountyEscrow workspace.',
};

export default function OAuthCallbackPage() {
  return (
    <AuthLayout
      aside={
        <Card className="gap-xs px-xl py-lg" variant="subtle">
          <p className="text-label-sm text-text-muted">SECURE SIGN-IN</p>
          <p className="text-h3 text-escrow">Identity verified by Google</p>
        </Card>
      }
      eyebrow="AUTHENTICATING"
      footnote={<NetworkStatus />}
      headline="One identity, the right workspace."
      lede="BountyEscrow checks your account profile after Google sign-in and routes you to the correct role."
    >
      <Suspense fallback={<AuthCardSkeleton />}>
        <OAuthCallback />
      </Suspense>
    </AuthLayout>
  );
}
