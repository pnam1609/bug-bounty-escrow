'use client';

import { WorkspaceShell } from '@bug-bounty-escrow/ui';
import type { ReactNode } from 'react';

import { AppFooter, AppHeader } from '@/components/programs/researcher-shell';

/*
 * Owner workspace chrome — Figma `Owner · Create program flow` (95:318). Every frame in the
 * section repeats the same geometry, already confirmed against the design:
 *
 *   Header / Desktop    1440 x 80
 *   Workspace Main      1440 wide (no left rail)
 *   Footer / Desktop    1440 x 88
 *
 * All of that lives in `WorkspaceShell`; this component only supplies the slots.
 */

export interface OwnerWorkspaceProps {
  readonly children: ReactNode;
  /** Kept for route compatibility; active state now lives in the shared account menu. */
  readonly activeHref?: string;
  /** Removes every workspace navigation target while a blocking lifecycle mutation is pending. */
  readonly navigationLocked?: boolean;
}

export function OwnerWorkspace({ children, navigationLocked = false }: OwnerWorkspaceProps) {
  return (
    <WorkspaceShell
      aria-busy={navigationLocked || undefined}
      header={<AppHeader brandHref="/owner/programs" navigationLocked={navigationLocked} />}
      footer={<AppFooter />}
    >
      {children}
    </WorkspaceShell>
  );
}

export interface WorkspaceHeadingProps {
  /** `Programs / Create program`. Rendered as a nav landmark with a link on the first crumb. */
  readonly breadcrumb: ReactNode;
  /** Small uppercase line directly above the title, e.g. CP-01 `NEW BOUNTY PROGRAM`. */
  readonly eyebrow?: string | undefined;
  readonly title: string;
  readonly subtitle?: string;
  /** Right-aligned status pill, e.g. the `Draft` badge. */
  readonly badge?: ReactNode;
}

export function WorkspaceHeading({
  badge,
  breadcrumb,
  eyebrow,
  subtitle,
  title,
}: WorkspaceHeadingProps) {
  return (
    <div className="flex flex-col gap-md">
      <nav aria-label="Breadcrumb" className="text-label-md text-text-muted">
        {breadcrumb}
      </nav>
      <div className="flex flex-wrap items-start gap-lg">
        <div className="flex min-w-0 flex-1 flex-col gap-sm">
          {eyebrow === undefined ? null : (
            <p className="text-label-md font-semibold uppercase text-primary">{eyebrow}</p>
          )}
          <h1 className="text-h1 text-text">{title}</h1>
          {subtitle === undefined ? null : (
            <p className="max-w-[820px] text-body text-text-muted">{subtitle}</p>
          )}
        </div>
        {badge}
      </div>
    </div>
  );
}

/** The 304px guidance column that sits beside every form card in the flow. */
export function GuidancePanel({
  children,
  eyebrow,
  title,
}: {
  readonly children: ReactNode;
  readonly eyebrow: string;
  readonly title: string;
}) {
  return (
    <aside className="flex h-fit flex-col gap-md rounded-lg border border-border bg-surface p-xl">
      <p className="text-label-sm uppercase text-primary">{eyebrow}</p>
      <p className="text-h3 text-text">{title}</p>
      <div className="flex flex-col gap-sm text-body-sm text-text-muted">{children}</div>
    </aside>
  );
}
