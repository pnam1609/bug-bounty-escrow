'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
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
import { ChevronDown } from 'lucide-react';

import { ACCOUNT_SETTINGS_PATH } from '@/components/account/account-settings-model';
import { LogoutMenuItem } from '@/components/account/logout-action';
import { useCurrentUser } from '@/hooks/use-current-user';

/*
 * Owner workspace chrome — Figma `Owner · Create program flow` (95:318). Every frame in the
 * section repeats the same geometry, already confirmed against the design:
 *
 *   Header / Desktop    1440 x 80
 *   Workspace Sidebar    240 wide at x=0, active item "Programs"
 *   Workspace Main      1200 wide at x=240
 *   Footer / Desktop    1440 x 88
 *
 * All of that lives in `WorkspaceShell`; this component only supplies the slots.
 */

const HEADER_LINKS = [
  { href: '/programs', label: 'Programs' },
  { href: '/reports', label: 'Reports' },
] as const;

const SIDEBAR_LINKS = [
  { href: '/owner/programs', label: 'Programs' },
  { href: '/review', label: 'Reports / review inbox' },
] as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part.charAt(0)).join('');
  return letters === '' ? 'BB' : letters.toUpperCase();
}

/** Right-hand header region: the OWNER role pill and the signed-in account menu. */
function AccountBadge() {
  const user = useCurrentUser();
  const displayName = user.data?.displayName ?? 'Owner';

  return (
    <>
      <span className="inline-flex items-center rounded-full border border-border-brand px-md py-xs text-label-sm font-semibold uppercase text-primary">
        Owner
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex min-h-11 items-center gap-md rounded-full px-sm text-body-sm text-text"
            type="button"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-label-sm text-text"
            >
              {initialsOf(displayName)}
            </span>
            <span className="hidden sm:inline">{displayName}</span>
            <ChevronDown aria-hidden="true" className="size-4 text-text-muted" />
            <span className="sr-only">Open account menu</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56">
          <DropdownMenuLabel>
            <span className="block text-body-sm text-text">{displayName}</span>
            <span className="block text-label-sm text-text-muted">Program owner</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href={ACCOUNT_SETTINGS_PATH}>Account settings</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <LogoutMenuItem />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export interface OwnerWorkspaceProps {
  readonly children: ReactNode;
  /** Route the sidebar should paint as current. Defaults to the Programs rail item. */
  readonly activeHref?: string;
  /** Removes every workspace navigation target while a blocking lifecycle mutation is pending. */
  readonly navigationLocked?: boolean;
}

export function OwnerWorkspace({
  activeHref = '/owner/programs',
  children,
  navigationLocked = false,
}: OwnerWorkspaceProps) {
  return (
    <WorkspaceShell
      aria-busy={navigationLocked || undefined}
      header={
        <SiteHeader
          actions={<AccountBadge />}
          brand={
            navigationLocked ? (
              <span aria-disabled="true" className="rounded-sm">
                <SiteBrand />
              </span>
            ) : (
              <Link href="/" className="rounded-sm">
                <SiteBrand />
              </Link>
            )
          }
          nav={
            <SiteNav aria-label="Primary">
              {HEADER_LINKS.map((link) =>
                navigationLocked ? (
                  <SiteNavItem aria-disabled="true" className="pointer-events-none" key={link.href}>
                    {link.label}
                  </SiteNavItem>
                ) : (
                  <SiteNavItem asChild key={link.href}>
                    <Link href={link.href}>{link.label}</Link>
                  </SiteNavItem>
                ),
              )}
              <SiteNavItem
                aria-disabled="true"
                className="pointer-events-none text-text-disabled"
                href={navigationLocked ? undefined : '#'}
              >
                Transactions · FUTURE
              </SiteNavItem>
            </SiteNav>
          }
        />
      }
      sidebar={
        <WorkspaceNav aria-label="Owner workspace" title="Owner workspace">
          {SIDEBAR_LINKS.map((link) =>
            navigationLocked ? (
              <WorkspaceNavItem active={activeHref === link.href} disabled key={link.href}>
                {link.label}
              </WorkspaceNavItem>
            ) : (
              <WorkspaceNavItem asChild active={activeHref === link.href} key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </WorkspaceNavItem>
            ),
          )}
          <WorkspaceNavItem disabled href={navigationLocked ? undefined : '#'}>
            Transactions · Future
          </WorkspaceNavItem>
          {navigationLocked ? (
            <WorkspaceNavItem active={activeHref === ACCOUNT_SETTINGS_PATH} disabled>
              Account settings
            </WorkspaceNavItem>
          ) : (
            <WorkspaceNavItem asChild active={activeHref === ACCOUNT_SETTINGS_PATH}>
              <Link href={ACCOUNT_SETTINGS_PATH}>Account settings</Link>
            </WorkspaceNavItem>
          )}
        </WorkspaceNav>
      }
      footer={
        <SiteFooter
          copyright="© 2026 BountyEscrow · Arc Testnet"
          legal={
            <>
              <SiteFooterLink
                aria-disabled={navigationLocked || undefined}
                className={navigationLocked ? 'pointer-events-none' : undefined}
                href={navigationLocked ? undefined : '/'}
              >
                Privacy
              </SiteFooterLink>
              <SiteFooterLink
                aria-disabled={navigationLocked || undefined}
                className={navigationLocked ? 'pointer-events-none' : undefined}
                href={navigationLocked ? undefined : '/'}
              >
                Terms
              </SiteFooterLink>
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
