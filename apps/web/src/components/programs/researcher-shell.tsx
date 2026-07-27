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
  SiteHeader,
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
  { href: '/rewards', label: 'Rewards · Future', disabled: true },
  { href: ACCOUNT_SETTINGS_PATH, label: 'Account settings', disabled: false },
] as const);

export const RESEARCHER_LOGOUT_LABEL = ACCOUNT_SETTINGS_COPY.logOut;

function AccountMenu() {
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

  const displayName = user.data?.displayName ?? 'Your account';
  const role = user.data?.role;
  const initials = avatarInitials(displayName);
  const accountType = role === undefined ? 'Signed in' : `${ROLE_BADGE_LABELS[role]} account`;

  return (
    <>
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
          {RESEARCHER_ACCOUNT_MENU_ITEMS.map((item) => {
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
  return (
    <SiteHeader
      actions={<AccountMenu />}
      brand={
        <Link className="rounded-md" href="/programs">
          <SiteBrand />
        </Link>
      }
    />
  );
}

export interface ResearcherShellProps {
  readonly children: ReactNode;
  /**
   * Infinite-scroll data views omit the footer — a footer the reader can never reach is only a
   * jumping target. The design system says the same (`Footer / Desktop`, node 165:159).
   */
  readonly showFooter?: boolean;
  readonly width?: ResearcherContentWidth;
}

export function ResearcherShell({
  children,
  showFooter = false,
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
      {showFooter ? (
        <SiteFooter
          copyright={`© ${new Date().getFullYear()} BountyEscrow`}
          variant="short"
          width="frame"
        />
      ) : null}
    </div>
  );
}
