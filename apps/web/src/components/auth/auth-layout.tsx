import { Card, SiteBrand, SiteFooter } from '@bug-bounty-escrow/ui';
import type { ReactNode } from 'react';

/**
 * The two-panel auth frame: Figma `Layout / Sign In / Desktop` (61:115) and
 * `Layout / Sign Up / Desktop` (61:116) are the same shell with different brand copy, so it is
 * built once and the copy arrives as props.
 *
 * Desktop is 1440 = a 520px ambient brand panel beside a 920px form area. Below `lg` the brand
 * panel is dropped and only the lockup rides above the card: stacking a full marketing column on
 * top of a form pushes the first input off a 390px screen.
 *
 * The panel headline is marketing, so it is a styled paragraph — the page's only `h1` is the form
 * card title, which is what the screen is actually for.
 */

/** Brand panel width from the frame. Layout structure rather than spacing, so it stays a literal. */
const BRAND_PANEL_WIDTH = 'lg:w-[520px]';
/** Form card width from the frame (520px), centred in the 920px form area. */
const FORM_COLUMN_WIDTH = 'max-w-[520px]';

export interface AuthLayoutProps {
  /** Proof block under the brand copy — the escrow figure, or the trust checklist. */
  readonly aside: ReactNode;
  /** The form card. */
  readonly children: ReactNode;
  readonly eyebrow: string;
  /** Bottom line of the brand panel. */
  readonly footnote: ReactNode;
  readonly headline: string;
  readonly lede: string;
}

export function AuthLayout({
  aside,
  children,
  eyebrow,
  footnote,
  headline,
  lede,
}: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 flex-col lg:flex-row">
        <aside
          className={`hidden shrink-0 flex-col justify-between gap-3xl bg-ambient p-3xl lg:flex ${BRAND_PANEL_WIDTH}`}
        >
          <SiteBrand />

          <div className="flex max-w-[424px] flex-col gap-lg">
            <p className="text-label-md text-primary">{eyebrow}</p>
            <p className="text-h1 text-text">{headline}</p>
            <p className="max-w-[400px] text-body text-text-muted">{lede}</p>
            {aside}
          </div>

          {footnote}
        </aside>

        <main className="flex flex-1 flex-col items-center justify-center gap-2xl px-lg py-2xl lg:px-3xl">
          <div className="lg:hidden">
            <SiteBrand />
          </div>
          <div className={`flex w-full flex-col ${FORM_COLUMN_WIDTH}`}>{children}</div>
        </main>
      </div>

      <SiteFooter
        variant="short"
        width="frame"
        copyright="© 2026 BountyEscrow · Arc Testnet"
        legal={
          <>
            <p className="text-label-sm text-text-muted">Privacy</p>
            <p className="text-label-sm text-text-muted">Terms</p>
          </>
        }
        status={<NetworkStatus />}
      />
    </div>
  );
}

/**
 * Holds the card's footprint while the client form hydrates — the form reads `returnTo` with
 * `useSearchParams`, so it sits behind a Suspense boundary and the page must not jump when it
 * arrives.
 */
export function AuthCardSkeleton() {
  return (
    <Card
      aria-busy="true"
      className="min-h-[420px] w-full shadow-elevated"
      padding="lg"
      variant="subtle"
    >
      <p aria-live="polite" className="text-body-sm text-text-muted">
        Loading…
      </p>
    </Card>
  );
}

/**
 * The dot is decorative; "OPERATIONAL" carries the state, so the status never rests on the mint
 * hue alone.
 */
export function NetworkStatus() {
  return (
    <p className="text-label-sm text-escrow">
      <span aria-hidden="true">● </span>
      ARC TESTNET OPERATIONAL
    </p>
  );
}
