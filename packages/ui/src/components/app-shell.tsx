'use client';

import { createSlot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

import { cn } from './class-names.js';

/*
 * Figma — "07 · App Shell" (node 162:95): Header / Desktop (164:147) and Footer / Desktop
 * (165:159).
 *
 * Everything here is chrome and nothing more: no fetching, no routing, no "which nav item is
 * active" logic. Links arrive as slots or through `asChild`, so the app keeps ownership of
 * `next/link`, prefetching and the active route.
 *
 * The documentation frames in 162:95 are drawn at 1280px, but the real owner frames — CP-01
 * Overview (95:319) and OWNER-01 Programs landing (82:234) — are 1440px and lay out as:
 *
 *   Header / Desktop    x=0    y=0   1440x80
 *   Workspace Sidebar   x=0    y=80   240x…    (95:333 / 82:248)
 *   Workspace Main      x=240  y=80  1200x…
 *
 * So 240 + 1200 = the 1440 frame: main sits *beside* the rail rather than centred inside it.
 * Those three numbers are layout structure rather than spacing, so they are the one place this
 * file reaches past the spacing tokens — everything else is `p-*`/`gap-*` from theme.css.
 */

/** Outer desktop frame width. */
export const SHELL_FRAME_MAX_WIDTH = 1440;
/** Content column width for workspace screens. */
export const WORKSPACE_CONTENT_MAX_WIDTH = 1200;
/** Workspace sidebar rail width. */
export const WORKSPACE_SIDEBAR_WIDTH = 240;

const shellContainerVariants = cva('mx-auto w-full px-xl', {
  variants: {
    width: {
      content: 'max-w-[1200px]',
      frame: 'max-w-[1440px]',
      full: null,
    },
  },
  defaultVariants: {
    width: 'content',
  },
});

export const SHELL_WIDTHS = Object.freeze(['content', 'frame', 'full'] as const);
export type ShellWidth = (typeof SHELL_WIDTHS)[number];
export type ShellContainerVariants = VariantProps<typeof shellContainerVariants>;

/* ── Brand ──────────────────────────────────────────────────────────────────────────────── */

export interface SiteBrandProps extends ComponentPropsWithoutRef<'span'> {
  /** Two-letter mark inside the mint tile. */
  initials?: string;
  label?: ReactNode;
}

/**
 * Mint tile + wordmark. Deliberately not a link — wrap it in the app's own router link when it
 * should navigate: `<SiteHeader brand={<Link href="/"><SiteBrand /></Link>} />`.
 */
export const SiteBrand = forwardRef<HTMLSpanElement, SiteBrandProps>(function SiteBrand(
  { className, initials = 'BB', label = 'BountyEscrow', ...brandProps },
  ref,
) {
  return (
    <span {...brandProps} ref={ref} className={cn('inline-flex items-center gap-md', className)}>
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-escrow text-label-md text-primary-contrast"
      >
        {initials}
      </span>
      <span className="text-h3 text-text">{label}</span>
    </span>
  );
});

/* ── Navigation ─────────────────────────────────────────────────────────────────────────── */

const AnchorSlot = createSlot<HTMLAnchorElement, ComponentPropsWithoutRef<'a'>>('BbeAnchorSlot');

export type SiteNavProps = ComponentPropsWithoutRef<'nav'>;

export const SiteNav = forwardRef<HTMLElement, SiteNavProps>(function SiteNav(
  { className, ...navProps },
  ref,
) {
  return <nav {...navProps} ref={ref} className={cn('flex items-center gap-2xl', className)} />;
});

export interface SiteNavItemProps extends ComponentPropsWithoutRef<'a'> {
  /** Current route. The app decides this; the shell only paints it. */
  active?: boolean;
  /** Render the app's own link element instead of a bare `<a>`. */
  asChild?: boolean;
}

export const SiteNavItem = forwardRef<HTMLAnchorElement, SiteNavItemProps>(function SiteNavItem(
  { active = false, asChild = false, className, ...itemProps },
  ref,
) {
  const Component = asChild ? AnchorSlot : 'a';

  return (
    <Component
      {...itemProps}
      ref={ref}
      aria-current={active ? 'page' : undefined}
      data-active={active ? 'true' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center rounded-sm text-body-sm transition-colors',
        active ? 'text-text' : 'text-text-muted hover:text-text',
        'motion-reduce:transition-none',
        className,
      )}
    />
  );
});

/* ── Header ─────────────────────────────────────────────────────────────────────────────── */

export interface SiteHeaderProps extends ComponentPropsWithoutRef<'header'> {
  /** Right-hand region: sign-in buttons, account menu, role badge. */
  actions?: ReactNode;
  /** Defaults to a plain `SiteBrand`; pass a wrapped one to make it navigate. */
  brand?: ReactNode;
  /** Anything below the bar — a sub-nav, a breadcrumb strip, a banner. */
  children?: ReactNode;
  nav?: ReactNode;
}

/**
 * 80px bar on `surface` with a bottom hairline: brand, nav, flexible spacer, actions — the row
 * from node 164:147, re-confirmed against the in-frame instance 167:2177. All three context
 * variants in Figma (Public / Researcher / Owner) are the same bar with different `nav` and
 * `actions` slots, so they are the caller's business.
 *
 * The bar and its content are full-bleed. Responsive horizontal padding keeps controls away from
 * the viewport edge without wrapping them in a max-width container.
 */
export const SiteHeader = forwardRef<HTMLElement, SiteHeaderProps>(function SiteHeader(
  { actions, brand = <SiteBrand />, children, className, nav, ...headerProps },
  ref,
) {
  return (
    <header
      {...headerProps}
      ref={ref}
      className={cn('w-full border-b border-border bg-surface', className)}
    >
      <div
        className={cn(shellContainerVariants({ width: 'full' }), 'flex h-20 items-center gap-2xl')}
      >
        {brand}
        {nav}
        <div className="flex-1" />
        {actions ? <div className="flex items-center gap-md">{actions}</div> : null}
      </div>
      {children}
    </header>
  );
});

/* ── Footer ─────────────────────────────────────────────────────────────────────────────── */

export const SITE_FOOTER_VARIANTS = Object.freeze(['full', 'short'] as const);
export type SiteFooterVariant = (typeof SITE_FOOTER_VARIANTS)[number];

export interface SiteFooterColumnProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  title: ReactNode;
}

export const SiteFooterColumn = forwardRef<HTMLDivElement, SiteFooterColumnProps>(
  function SiteFooterColumn({ children, className, title, ...columnProps }, ref) {
    return (
      <div {...columnProps} ref={ref} className={cn('flex flex-col gap-xs', className)}>
        <p className="text-label-sm uppercase text-text">{title}</p>
        <div className="flex flex-col">{children}</div>
      </div>
    );
  },
);

export interface SiteFooterLinkProps extends ComponentPropsWithoutRef<'a'> {
  /** Render the app's own link element instead of a bare `<a>`. */
  asChild?: boolean;
}

export const SiteFooterLink = forwardRef<HTMLAnchorElement, SiteFooterLinkProps>(
  function SiteFooterLink({ asChild = false, className, ...linkProps }, ref) {
    const Component = asChild ? AnchorSlot : 'a';

    return (
      <Component
        {...linkProps}
        ref={ref}
        className={cn(
          // Figma stacks these on a 32px rhythm; 44px wins because CONVENTIONS.md makes the
          // hit area non-negotiable and a footer link is still a tap target.
          'inline-flex min-h-11 items-center rounded-sm text-body-sm text-text-muted transition-colors',
          'hover:text-text motion-reduce:transition-none',
          className,
        )}
      />
    );
  },
);

export interface SiteFooterProps extends ComponentPropsWithoutRef<'footer'> {
  /** `full` — public landing and long-form marketing. `short` — auth, onboarding, in-app. */
  variant?: SiteFooterVariant;
  /** Full variant: brand block to the left of the link columns. */
  brand?: ReactNode;
  /** Extra rows between the top region and the legal line. */
  children?: ReactNode;
  /** Full variant: the `SiteFooterColumn`s. */
  columns?: ReactNode;
  /** Legal line, both variants. */
  copyright?: ReactNode;
  /** Short variant: inline legal links. */
  legal?: ReactNode;
  /** Right-hand status line, e.g. network state. Both variants. */
  status?: ReactNode;
}

/**
 * Node 165:159. Both variants use the full viewport width with responsive edge padding. `full` is
 * the four-region marketing footer; `short` is the single 88px bar every in-app screen uses. Omit
 * the footer entirely on infinite-scroll data views — that call belongs to the layout.
 */
export const SiteFooter = forwardRef<HTMLElement, SiteFooterProps>(function SiteFooter(
  {
    brand,
    children,
    className,
    columns,
    copyright,
    legal,
    status,
    variant = 'full',
    ...footerProps
  },
  ref,
) {
  const isShort = variant === 'short';

  return (
    <footer
      {...footerProps}
      ref={ref}
      data-variant={variant}
      className={cn('w-full border-t border-border bg-surface', className)}
    >
      {isShort ? (
        <div
          className={cn(
            shellContainerVariants({ width: 'full' }),
            'flex min-h-22 flex-wrap items-center gap-xl py-lg',
          )}
        >
          {copyright ? <p className="text-label-sm text-text-muted">{copyright}</p> : null}
          <div className="flex-1" />
          {legal ? <div className="flex flex-wrap items-center gap-xl">{legal}</div> : null}
          {status}
          {children}
        </div>
      ) : (
        <div
          className={cn(
            shellContainerVariants({ width: 'full' }),
            'flex flex-col gap-2xl pt-3xl pb-2xl',
          )}
        >
          {brand || columns ? (
            <div className="flex flex-col gap-2xl md:flex-row md:items-start md:justify-between">
              {brand}
              {columns ? <div className="flex flex-wrap gap-2xl md:gap-3xl">{columns}</div> : null}
            </div>
          ) : null}
          {children}
          {copyright || status ? (
            <div className="flex flex-col gap-md sm:flex-row sm:items-center sm:justify-between">
              {copyright ? <p className="text-label-sm text-text-muted">{copyright}</p> : null}
              {status}
            </div>
          ) : null}
        </div>
      )}
    </footer>
  );
});

/* ── Workspace sidebar ──────────────────────────────────────────────────────────────────── */

export interface WorkspaceNavProps extends Omit<ComponentPropsWithoutRef<'nav'>, 'title'> {
  /** Small-caps section heading, e.g. "Owner workspace". Rendered uppercase. */
  title?: ReactNode;
}

/**
 * One titled group of rail links — the "OWNER WORKSPACE" section in nodes 95:333 / 82:248.
 * The heading sits 28px above the first item; items are stacked on a 56px pitch (44px tall,
 * 12px apart).
 */
export const WorkspaceNav = forwardRef<HTMLElement, WorkspaceNavProps>(function WorkspaceNav(
  { children, className, title, ...navProps },
  ref,
) {
  return (
    <nav {...navProps} ref={ref} className={cn('flex flex-col gap-xl', className)}>
      {title ? <p className="text-label-sm uppercase text-text-muted">{title}</p> : null}
      <div className="flex flex-col gap-md">{children}</div>
    </nav>
  );
});

export interface WorkspaceNavItemProps extends ComponentPropsWithoutRef<'a'> {
  /** Current route. The app decides this; the rail only paints it. */
  active?: boolean;
  /** Render the app's own link element instead of a bare `<a>`. */
  asChild?: boolean;
  /** Present but not yet reachable — Figma's "Transactions · Future" row. */
  disabled?: boolean;
}

/**
 * 44px pill, 10px radius, label inset from the pill edge. Active is `ambient` fill + full-strength
 * text + semibold; inactive is transparent + muted + medium; the future row drops to
 * `text-text-disabled`. Weight carries the active state alongside the fill, so it never rests on
 * colour alone.
 */
export const WorkspaceNavItem = forwardRef<HTMLAnchorElement, WorkspaceNavItemProps>(
  function WorkspaceNavItem(
    { active = false, asChild = false, className, disabled = false, ...itemProps },
    ref,
  ) {
    const Component = asChild ? AnchorSlot : 'a';

    return (
      <Component
        {...itemProps}
        ref={ref}
        aria-current={active ? 'page' : undefined}
        aria-disabled={disabled ? true : undefined}
        data-active={active ? 'true' : undefined}
        className={cn(
          'flex min-h-11 w-full items-center rounded-md px-md text-label-lg transition-colors',
          active ? 'bg-ambient font-semibold text-text' : 'text-text-muted',
          !active && !disabled ? 'hover:bg-surface-raised hover:text-text' : null,
          disabled ? 'pointer-events-none text-text-disabled' : null,
          'motion-reduce:transition-none',
          className,
        )}
      />
    );
  },
);

/* ── Workspace shell ────────────────────────────────────────────────────────────────────── */

export interface WorkspaceShellProps extends ComponentPropsWithoutRef<'div'> {
  /** Usually a `SiteFooter variant="short"`; omit it on infinite-scroll data views. */
  footer?: ReactNode;
  /** Usually a `SiteHeader`. */
  header?: ReactNode;
  mainClassName?: string;
  /**
   * The 240px left rail — usually a `WorkspaceNav`. Hidden below `lg`; give the app a drawer for
   * small screens. Omit it entirely for researcher screens: Program Detail and Submit Bug are
   * specified without a rail.
   */
  sidebar?: ReactNode;
  sidebarClassName?: string;
  /** Max width of the content column. Defaults to the 1200px workspace column. */
  width?: ShellWidth;
}

/**
 * Header + optional 240px rail + main, filling at least the viewport so the footer never floats
 * up on a short page. The shell chrome spans the viewport; the main content keeps its own width
 * constraint so wide screens gain breathing room without stretching readable content.
 */
export const WorkspaceShell = forwardRef<HTMLDivElement, WorkspaceShellProps>(
  function WorkspaceShell(
    {
      children,
      className,
      footer,
      header,
      mainClassName,
      sidebar,
      sidebarClassName,
      width = 'content',
      ...shellProps
    },
    ref,
  ) {
    return (
      <div
        {...shellProps}
        ref={ref}
        className={cn('flex min-h-screen w-full flex-col bg-background', className)}
      >
        {header}
        <div className="flex w-full flex-1">
          {sidebar ? (
            // 240px, `surface` fill, and deliberately no right hairline — Figma separates the
            // rail from main by surface colour alone (95:333 draws no border).
            <aside className={cn('hidden w-60 shrink-0 bg-surface lg:block', sidebarClassName)}>
              <div className="sticky top-0 px-2xl py-2xl">{sidebar}</div>
            </aside>
          ) : null}
          <main className={cn('min-w-0 flex-1', mainClassName)}>
            <div className={cn(shellContainerVariants({ width }), 'py-2xl')}>{children}</div>
          </main>
        </div>
        {footer}
      </div>
    );
  },
);
