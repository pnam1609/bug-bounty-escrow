'use client';

import { WorkspaceShell } from '@bug-bounty-escrow/ui';
import type { ReactNode } from 'react';

import { AppFooter, AppHeader } from '@/components/programs/researcher-shell';

/*
 * No Figma source — chrome for the two reviewer routes.
 *
 * Review uses the same header/footer as every other non-landing screen. The old owner-style rail
 * was removed so reviewers and owners get one consistent shell on every route.
 */

export interface ReviewShellProps {
  readonly children: ReactNode;
  /** Route the rail should paint as current. */
  readonly activeHref?: string;
}

export function ReviewShell({ children }: ReviewShellProps) {
  return (
    <WorkspaceShell footer={<AppFooter />} header={<AppHeader brandHref="/programs" />}>
      {children}
    </WorkspaceShell>
  );
}
