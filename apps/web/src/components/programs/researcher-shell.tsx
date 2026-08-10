'use client';

import {
  Button,
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
} from '@bug-bounty-escrow/ui';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  ACCOUNT_SETTINGS_COPY,
  ACCOUNT_SETTINGS_PATH,
  avatarInitials,
} from '@/components/account/account-settings-model';
import { LogoutMenuItem } from '@/components/account/logout-action';
import { ROLE_BADGE_LABELS } from '@/components/onboarding/role-options';
import { useCurrentUser } from '@/hooks/use-current-user';
import { getSiteCopyright } from '@/lib/site-footer';
import { useAuth } from '@/providers/auth-provider';

/*
 * Researcher app shell.
 *
 * Researcher screens have no left rail: the header spans the frame and the content column centres
 * beneath it — 1312px for the bounty table, 1104px for program detail (§5, §13).
 *
 * The account menu is `RS-NAV-01`. Radix gives it the focus trap, `Escape` and return-focus for
 * free, so none of that is re-implemented here; `Logout` sits after a divider at the foot of the
 * list because it is the one destructive item.
 */

export const RESEARCHER_CONTENT_WIDTHS = {
  /** Bounty table and other full-width data views. */
  table: 'max-w-7xl',
  /** Program detail and the submit-bug flow. */
  detail: 'max-w-6xl',
} as const;

export type ResearcherContentWidth = keyof typeof RESEARCHER_CONTENT_WIDTHS;

export const RESEARCHER_ACCOUNT_MENU_ITEMS = Object.freeze([
  { href: '/programs', label: 'Browse programs', disabled: false },
  { href: '/reports', label: 'My reports', disabled: false },
  { href: '/rewards', label: 'Rewards', disabled: false },
  { href: ACCOUNT_SETTINGS_PATH, label: 'Account settings', disabled: false },
] as const);

/** Destinations shown in the account menu for a program owner. */
export const OWNER_ACCOUNT_MENU_ITEMS = Object.freeze([
  { href: '/owner/programs', label: 'My programs', disabled: false },
  { href: '/review', label: 'Reports / review inbox', disabled: false },
  { href: '#', label: 'Transactions · Future', disabled: true },
  { href: ACCOUNT_SETTINGS_PATH, label: 'Account settings', disabled: false },
] as const);

/** Assigned reviewers do not receive owner-only program management links. */
export const REVIEWER_ACCOUNT_MENU_ITEMS = Object.freeze([
  { href: '/review', label: 'Review inbox', disabled: false },
  { href: ACCOUNT_SETTINGS_PATH, label: 'Account settings', disabled: false },
] as const);

/** Common top-level navigation for every authenticated/public app screen (landing is separate). */
export const APP_HEADER_NAV_ITEMS = Object.freeze([
  { href: '/programs', label: 'Programs' },
  { href: '/#how-escrow-works', label: 'How it works' },
  { href: '/#live-escrow', label: 'Escrow' },
  { href: '/#why-bountyescrow', label: 'Security' },
] as const);

export const RESEARCHER_LOGOUT_LABEL = ACCOUNT_SETTINGS_COPY.logOut;

function menuItemsForRole(role: 'owner' | 'researcher' | 'reviewer' | undefined) {
  if (role === 'owner') return OWNER_ACCOUNT_MENU_ITEMS;
  if (role === 'reviewer') return REVIEWER_ACCOUNT_MENU_ITEMS;
  return RESEARCHER_ACCOUNT_MENU_ITEMS;
}

/**
 * Session-aware account actions shared by public app chrome and the marketing landing.
 *
 * Keeping this in one place prevents the landing from painting a stale `Sign in` action while
 * Supabase restores an existing session, and gives every public entry point the same role/account
 * treatment once authentication has resolved.
 */
export function HeaderAccountMenu() {
  const { loading, session } = useAuth();
  const user = useCurrentUser();
  const pathname = usePathname();

  if (loading) {
    return (
      <span
        aria-label="Loading account"
        className="size-11 rounded-full border border-border bg-surface-raised"
        role="status"
      />
    );
  }

  if (session === null) {
    return (
      <>
        <Button asChild variant="ghost">
          <Link href="/login">Sign in</Link>
        </Button>
        <Button asChild>
          <Link href="/register">Create account</Link>
        </Button>
      </>
    );
  }

  // A role is server-owned. Keep the account region neutral until `/api/me` resolves instead of
  // briefly painting researcher destinations for an owner session.
  if (user.data === undefined) {
    return (
      <span
        aria-label="Loading account"
        className="size-11 rounded-full border border-border bg-surface-raised"
        role="status"
      />
    );
  }

  const displayName = user.data.displayName;
  const role = user.data.role;
  const initials = avatarInitials(displayName);
  const accountType = role === undefined ? 'Signed in' : `${ROLE_BADGE_LABELS[role]} account`;
  const menuItems = menuItemsForRole(role);

  return (
    <>
      {role === 'owner' ? (
        <Button asChild className="hidden sm:inline-flex" variant="ghost">
          <Link href="/owner/programs">Open workspace</Link>
        </Button>
      ) : null}
      {role === undefined ? null : (
        <span className="hidden items-center rounded-full border border-border-brand bg-surface-raised px-md py-xs text-label-sm uppercase text-escrow sm:inline-flex">
          {role}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex min-h-11 items-center gap-md rounded-full px-sm text-body-sm text-text"
            type="button"
          >
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-label-md text-text"
            >
              {initials}
            </span>
            <span className="hidden sm:inline">{displayName}</span>
            <ChevronDown aria-hidden="true" className="size-4 text-text-muted" />
            <span className="sr-only">Open account menu</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="min-w-56">
          <DropdownMenuLabel className="flex items-center gap-md">
            <span
              aria-hidden="true"
              className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-label-md text-text"
            >
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-body-sm text-text">{displayName}</span>
              <span className="block text-label-sm text-text-muted">{accountType}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {menuItems.map((item) => {
            const active = pathname === item.href;
            return item.disabled ? (
              <DropdownMenuItem disabled key={item.href}>
                {item.label}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                asChild
                className={active ? 'bg-ambient text-text' : undefined}
                key={item.href}
              >
                <Link aria-current={active ? 'page' : undefined} href={item.href}>
                  {item.label}
                </Link>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <LogoutMenuItem />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** Shared researcher chrome for Browse, Program detail and every Submit Bug state. */
export function ResearcherHeader() {
  return <AppHeader />;
}

export interface AppHeaderProps {
  /** Disable navigation while a lifecycle mutation is in flight. */
  readonly navigationLocked?: boolean;
  /** Override the role-derived brand destination for a shell with a known workspace. */
  readonly brandHref?: string;
  /** Hide account actions while a profile is loading (account settings skeleton). */
  readonly showAccount?: boolean;
}

/** One header implementation shared by researcher, owner and reviewer shells. */
export function AppHeader({
  brandHref,
  navigationLocked = false,
  showAccount = true,
}: AppHeaderProps = {}) {
  const user = useCurrentUser();
  const derivedBrandHref =
    brandHref ?? (user.data?.role === 'owner' ? '/owner/programs' : '/programs');

  return (
    <SiteHeader
      actions={showAccount ? <HeaderAccountMenu /> : null}
      brand={
        navigationLocked ? (
          <span aria-disabled="true" className="rounded-md">
            <SiteBrand />
          </span>
        ) : (
          <Link className="rounded-md" href={derivedBrandHref}>
            <SiteBrand />
          </Link>
        )
      }
      nav={
        <SiteNav aria-label="Primary" className="hidden lg:flex">
          {APP_HEADER_NAV_ITEMS.map((item) =>
            navigationLocked ? (
              <SiteNavItem aria-disabled="true" className="pointer-events-none" key={item.href}>
                {item.label}
              </SiteNavItem>
            ) : (
              <SiteNavItem asChild key={item.href}>
                <Link href={item.href}>{item.label}</Link>
              </SiteNavItem>
            ),
          )}
        </SiteNav>
      }
    />
  );
}

/** Shared short footer for all non-landing app screens. */
export function AppFooter() {
  return (
    <SiteFooter
      copyright={getSiteCopyright(' · Arc Testnet')}
      legal={
        <>
          <SiteFooterLink asChild>
            <Link href="/">Privacy</Link>
          </SiteFooterLink>
          <SiteFooterLink asChild>
            <Link href="/">Terms</Link>
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
  );
}

export interface ResearcherShellProps {
  readonly children: ReactNode;
  /**
   * Every in-app screen shares the short footer. The landing page is the only screen that uses the
   * long marketing footer.
   */
  readonly showFooter?: boolean;
  readonly width?: ResearcherContentWidth;
}

export function ResearcherShell({
  children,
  showFooter = true,
  width = 'table',
}: ResearcherShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <ResearcherHeader />
      <main className="flex-1">
        <div
          className={`mx-auto w-full ${RESEARCHER_CONTENT_WIDTHS[width]} px-lg py-2xl md:px-2xl lg:px-3xl`}
        >
          {children}
        </div>
      </main>
      {showFooter ? <AppFooter /> : null}
    </div>
  );
}
