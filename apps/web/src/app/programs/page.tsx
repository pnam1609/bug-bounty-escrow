import type { Metadata } from 'next';
import { Suspense } from 'react';

import { BountyTableView, BountyTableViewFallback } from '@/components/programs/bounty-table-view';
import { ResearcherShell } from '@/components/programs/researcher-shell';

export const metadata: Metadata = {
  title: 'Find your next bounty · BountyEscrow',
  description:
    'Compare transparent reward pools, verified scope and USDC payouts before you start researching.',
};

/**
 * Public bounty table. Anonymous visitors are welcome — `GET /api/programs` only ever returns
 * publicly listed programs, so there is no role guard here.
 *
 * The list is an infinite-scroll data view, so the shell omits the footer: a footer below an
 * endless list is a target the reader can never reach.
 */
export default function ProgramsPage() {
  return (
    <ResearcherShell width="table">
      {/* `useSearchParams` inside the view suspends until the client knows the query string. */}
      <Suspense fallback={<BountyTableViewFallback />}>
        <BountyTableView />
      </Suspense>
    </ResearcherShell>
  );
}
