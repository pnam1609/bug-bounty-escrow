import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ProgramDetailView } from '@/components/programs/program-detail-view';
import { ResearcherShell } from '@/components/programs/researcher-shell';

export const metadata: Metadata = {
  title: 'Program detail · BountyEscrow',
  description:
    'Scope, impacts, reward tiers and rules for a public bounty program, with USDC payouts held in escrow.',
};

/**
 * Public program detail — submit-bug flow §8 `PG-DETAIL`. Content is capped at the 1104px
 * researcher column and there is no sidebar.
 */
export default async function ProgramPage({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <ResearcherShell showFooter width="detail">
      {/* The selected tab lives in `?tab=`, so the view reads the query string on the client. */}
      <Suspense fallback={<p className="text-body-sm text-text-muted">Loading program…</p>}>
        <ProgramDetailView slug={slug} />
      </Suspense>
    </ResearcherShell>
  );
}
