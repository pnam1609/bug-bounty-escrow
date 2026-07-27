import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AccessDeniedCard } from '@/components/onboarding/access-denied-card';

export const metadata: Metadata = {
  title: 'Workspace unavailable · BountyEscrow',
  description: 'This route belongs to a workspace your account is not set up for.',
};

/**
 * `/access-denied` — ACCESS-01 (82:414). The safe landing for a wrong-role deep link.
 *
 * Callers pass the blocked path as `?from=/owner/programs`; it is only echoed back after being
 * checked as a safe internal path, and no data from that route is ever requested. `useSearchParams`
 * needs a Suspense boundary, same as the login form.
 */
export default function AccessDeniedPage() {
  return (
    <Suspense fallback={null}>
      <AccessDeniedCard />
    </Suspense>
  );
}
