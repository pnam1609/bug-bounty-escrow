'use client';

import { useParams } from 'next/navigation';

import { ReviewDetailView } from '@/components/reports/review-detail-view';
import { ReviewShell } from '@/components/reports/review-shell';
import { RoleGuard } from '@/components/role-guard';

/*
 * No Figma source — one report, seen by a reviewer.
 *
 * The guard is the boundary that keeps private disclosure content off any surface an unauthorised
 * account can reach; the server enforces the same rule per report, so a reviewer who is not
 * assigned to the program gets the "not available" state rather than the content.
 */

export default function ReviewDetailPage() {
  const id = String(useParams<{ id: string }>().id);

  return (
    <RoleGuard allow={['owner', 'reviewer']}>
      <ReviewShell activeHref="/review">
        <ReviewDetailView id={id} />
      </ReviewShell>
    </RoleGuard>
  );
}
