'use client';

import {
  SiteBrand,
  SiteFooter,
  SiteFooterLink,
  SiteHeader,
  SiteNav,
  SiteNavItem,
  WorkspaceNav,
  WorkspaceNavItem,
  WorkspaceShell,
} from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ACCOUNT_SETTINGS_PATH } from '@/components/account/account-settings-model';
import { useCurrentUser } from '@/hooks/use-current-user';

/*
 * No Figma source — chrome for the two reviewer routes.
 *
 * The geometry is the owner workspace from `07 · App Shell` (header 80, 240px rail, 1200px main,
 * 88px short footer), assembled here rather than reused from `components/owner/owner-workspace.tsx`
 * because that shell hard-codes "Owner": an assigned reviewer who is not the program owner would
 * be told they are one, and would be offered rail links they cannot open.
 */

function AccountBadge() {
  const user = useCurrentUser();
  const role = user.data?.role;
  const displayName = user.data?.displayName ?? 'Your account';
  const initials =
    displayName
      .split(/\s+/)
      .filter((part) => part !== '')
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'BB';

  return (
    <>
      {role === undefined ? null : (
        <span className="hidden items-center rounded-full border border-border-brand px-md py-xs text-label-sm font-semibold uppercase text-primary sm:inline-flex">
          {role}
        </span>
      )}
      <span className="inline-flex items-center gap-sm">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-label-sm text-text"
        >
          {initials}
        </span>
        <span className="hidden text-body-sm text-text sm:inline">{displayName}</span>
      </span>
    </>
  );
}

export interface ReviewShellProps {
  readonly children: ReactNode;
  /** Route the rail should paint as current. */
  readonly activeHref?: string;
}

export function ReviewShell({ activeHref = '/review', children }: ReviewShellProps) {
  const user = useCurrentUser();
  const isOwner = user.data?.role === 'owner';

  return (
    <WorkspaceShell
      footer={
        <SiteFooter
          copyright={`© ${new Date().getFullYear()} BountyEscrow · Arc Testnet`}
          legal={
            <>
              <SiteFooterLink href="/">Privacy</SiteFooterLink>
              <SiteFooterLink href="/">Terms</SiteFooterLink>
            </>
          }
          status={
            <span className="inline-flex items-center gap-sm text-label-sm font-semibold uppercase text-escrow">
              <span aria-hidden="true" className="size-sm rounded-full bg-escrow" />
              Arc testnet operational
            </span>
          }
          variant="short"
        />
      }
      header={
        <SiteHeader
          actions={<AccountBadge />}
          brand={
            <Link className="rounded-sm" href="/programs">
              <SiteBrand />
            </Link>
          }
          nav={
            <SiteNav aria-label="Primary">
              <SiteNavItem asChild>
                <Link href="/programs">Programs</Link>
              </SiteNavItem>
              <SiteNavItem active asChild>
                <Link href="/review">Review inbox</Link>
              </SiteNavItem>
            </SiteNav>
          }
        />
      }
      sidebar={
        <WorkspaceNav aria-label="Review workspace" title="Review workspace">
          <WorkspaceNavItem active={activeHref === '/review'} asChild>
            <Link href="/review">Review inbox</Link>
          </WorkspaceNavItem>
          {/* An assigned reviewer has no owner routes, so the rail does not offer them. */}
          {isOwner ? (
            <WorkspaceNavItem active={activeHref === '/owner/programs'} asChild>
              <Link href="/owner/programs">My programs</Link>
            </WorkspaceNavItem>
          ) : null}
          <WorkspaceNavItem disabled href="#">
            Transactions · Future
          </WorkspaceNavItem>
          <WorkspaceNavItem active={activeHref === ACCOUNT_SETTINGS_PATH} asChild>
            <Link href={ACCOUNT_SETTINGS_PATH}>Account settings</Link>
          </WorkspaceNavItem>
        </WorkspaceNav>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
