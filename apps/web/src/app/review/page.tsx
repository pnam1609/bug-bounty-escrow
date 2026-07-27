import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ReportListSkeleton } from '@/components/reports/report-states';
import { ReviewInboxView } from '@/components/reports/review-inbox-view';
import { ReviewShell } from '@/components/reports/review-shell';
import { RoleGuard } from '@/components/role-guard';

/*
 * No Figma source — the reviewer inbox.
 *
 * Owners and assigned reviewers work from the workspace geometry in `07 · App Shell`: header,
 * 240px rail, 1200px main. The rail is `ReviewShell`, not the owner workspace, because an assigned
 * reviewer is not an owner and must not be shown owner-only destinations.
 */

export const metadata: Metadata = {
  title: 'Review inbox · BountyEscrow',
  description: 'Reports awaiting a decision on the programs you own or review.',
};

export default function ReviewInboxPage() {
  return (
    <RoleGuard allow={['owner', 'reviewer']}>
      <ReviewShell activeHref="/review">
        {/* Filters live in the query string, so the view suspends until the client knows it. */}
        <Suspense fallback={<ReportListSkeleton />}>
          <ReviewInboxView />
        </Suspense>
      </ReviewShell>
    </RoleGuard>
  );
}
