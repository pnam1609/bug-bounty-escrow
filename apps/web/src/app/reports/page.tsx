import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ResearcherShell } from '@/components/programs/researcher-shell';
import { ReportListView } from '@/components/reports/report-list-view';
import { ReportListPageSkeleton } from '@/components/reports/report-states';
import { RoleGuard } from '@/components/role-guard';

/*
 * No Figma source — "My reports".
 *
 * It shares the researcher shell and the 1104px column with the report detail screen, which is
 * where SR-07's "My reports" breadcrumb and secondary action point. The list is paged rather than
 * infinite, so the short footer stays: the reader can always reach it.
 */

export const metadata: Metadata = {
  title: 'My reports · BountyEscrow',
  description: 'Every private disclosure you have filed, and where each one is in review.',
};

export default function ReportsPage() {
  return (
    <RoleGuard allow={['researcher']}>
      <ResearcherShell showFooter width="table">
        {/* Filters live in the query string, so the view suspends until the client knows it. */}
        <Suspense fallback={<ReportListPageSkeleton />}>
          <ReportListView />
        </Suspense>
      </ResearcherShell>
    </RoleGuard>
  );
}
