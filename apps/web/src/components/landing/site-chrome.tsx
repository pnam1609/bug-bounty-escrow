import {
  Button,
  SiteBrand,
  SiteFooter,
  SiteFooterColumn,
  SiteFooterLink,
  SiteHeader,
  SiteNav,
  SiteNavItem,
} from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';

/*
 * Header instance 167:525 and footer instance 167:541 on the landing frame. Both are the shell
 * components from `@bug-bounty-escrow/ui`; this file only supplies the Public-context slots.
 */

interface ChromeLink {
  readonly href: string;
  readonly label: string;
}

const HEADER_NAV: readonly ChromeLink[] = [
  { href: '/programs', label: 'Programs' },
  { href: '#how-escrow-works', label: 'How it works' },
  { href: '#live-escrow', label: 'Escrow' },
  { href: '#why-bountyescrow', label: 'Security' },
];

/*
 * Figma's header instance paints "Programs" at full strength because it is drawn in the Public
 * context of the app shell. Nothing here is the current page, so no item gets `active` — that prop
 * also sets `aria-current="page"`, which would be a lie on `/`.
 */
export function LandingHeader(): ReactNode {
  return (
    <SiteHeader
      actions={
        <>
          {/* Below `sm` the bar keeps only the primary action so the row never forces a scroll. */}
          <Button asChild className="hidden sm:inline-flex" size="md" variant="ghost">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="md" variant="primary">
            <Link href="/programs">Launch app</Link>
          </Button>
        </>
      }
      brand={
        <Link className="inline-flex min-h-11 shrink-0 items-center rounded-md" href="/">
          <SiteBrand />
        </Link>
      }
      className="[&>div]:px-xl sm:[&>div]:px-2xl lg:[&>div]:px-3xl"
      nav={
        // Brand + four nav items + two actions need ~870px on one row, so the nav appears at
        // `lg`; between `sm` and `lg` the bar is brand plus actions and never forces a scroll.
        <SiteNav aria-label="Primary" className="hidden lg:flex">
          {HEADER_NAV.map((item) => (
            <SiteNavItem asChild key={item.href}>
              <Link href={item.href}>{item.label}</Link>
            </SiteNavItem>
          ))}
        </SiteNav>
      }
    />
  );
}

const FOOTER_COLUMNS: readonly { readonly links: readonly ChromeLink[]; readonly title: string }[] =
  [
    {
      title: 'Product',
      links: [
        { href: '/programs', label: 'Programs' },
        { href: '#how-escrow-works', label: 'How it works' },
        { href: '#live-escrow', label: 'Escrow' },
      ],
    },
    {
      title: 'Resources',
      links: [
        { href: '#how-escrow-works', label: 'Docs' },
        { href: '#why-bountyescrow', label: 'Security' },
        { href: '#trust-metrics', label: 'Status' },
      ],
    },
    {
      title: 'Company',
      links: [
        { href: '#why-bountyescrow', label: 'About' },
        { href: '#final-cta', label: 'Contact' },
        { href: '#final-cta', label: 'Legal' },
      ],
    },
  ];

/*
 * `variant="full"` per the component's own selection rule: the marketing footer is for the public
 * landing and long-form pages only.
 *
 * Every destination is a section of this page or a route that exists today. This is a demo product
 * — the footer says so — and a link that 404s is worse than one that scrolls.
 *
 * The `[&>div]` overrides re-point the shell's 1200px content column at the landing frame's 1344px
 * column so the footer lines up with the CTA panel above it, exactly as drawn.
 */
export function LandingFooter(): ReactNode {
  return (
    <SiteFooter
      brand={
        <div className="flex max-w-[380px] flex-col gap-md">
          <p className="text-h3 text-text">BountyEscrow</p>
          <p className="text-body-sm text-text-muted">
            Funded Web3 bug bounties with transparent pools and direct USDC settlement.
          </p>
        </div>
      }
      className="[&>div]:px-xl sm:[&>div]:px-2xl lg:[&>div]:px-3xl"
      columns={FOOTER_COLUMNS.map((column) => (
        <SiteFooterColumn key={column.title} title={column.title}>
          {column.links.map((link) => (
            <SiteFooterLink asChild key={`${column.title}-${link.label}`}>
              <Link href={link.href}>{link.label}</Link>
            </SiteFooterLink>
          ))}
        </SiteFooterColumn>
      ))}
      copyright="© 2026 BountyEscrow. Demo product on Arc Testnet."
      status={
        <p className="inline-flex items-center gap-sm text-label-sm uppercase text-escrow">
          <span aria-hidden="true" className="size-sm shrink-0 rounded-full bg-escrow" />
          Arc Testnet operational
        </p>
      }
      variant="full"
    />
  );
}
