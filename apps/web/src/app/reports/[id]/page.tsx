'use client';

import { useParams } from 'next/navigation';
import { Suspense } from 'react';

import { ResearcherShell } from '@/components/programs/researcher-shell';
import { ReportDetailView } from '@/components/reports/report-detail-view';
import { ReportDetailSkeleton } from '@/components/reports/report-states';
import { RoleGuard } from '@/components/role-guard';

/*
 * SR-07 — Submitted, Figma `151:105`. This route is the report detail for every status; SR-07 is
 * what it looks like right after a successful submit, which is where the composer lands.
 *
 * The frame is a 1440px desktop with 168px gutters, so the content column is 1104px — exactly
 * `ResearcherShell width="detail"` — under the researcher header and above the short in-app
 * footer that the design system prescribes for in-app workflows.
 */

export default function ReportDetailPage() {
  const id = String(useParams<{ id: string }>().id);

  return (
    <RoleGuard allow={['researcher']}>
      <ResearcherShell showFooter width="detail">
        <Suspense fallback={<ReportDetailSkeleton />}>
          <ReportDetailView id={id} />
        </Suspense>
      </ResearcherShell>
    </RoleGuard>
  );
}
