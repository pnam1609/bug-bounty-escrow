import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ResearcherShell } from '@/components/programs/researcher-shell';
import { RewardDashboard } from '@/components/rewards/reward-dashboard';
import { RewardListSkeleton } from '@/components/rewards/reward-states';
import { RoleGuard } from '@/components/role-guard';

export const metadata: Metadata = {
  title: 'Rewards & payouts · BountyEscrow',
  description:
    'Track human-approved USDC rewards and backend-verified on-chain settlement evidence.',
};

/** RW-03 — researcher-owned reward activity from the authorization-safe RW-02 read model. */
export default function RewardsPage() {
  return (
    <RoleGuard allow={['researcher']}>
      <ResearcherShell showFooter width="table">
        <Suspense fallback={<RewardListSkeleton />}>
          <RewardDashboard />
        </Suspense>
      </ResearcherShell>
    </RoleGuard>
  );
}
