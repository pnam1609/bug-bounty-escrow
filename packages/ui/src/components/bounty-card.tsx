import { ArrowUpRight } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

// Type-only import: see `status-badge.tsx`. The union comes from `packages/domain`, not from here.
import type { Severity } from '@bug-bounty-escrow/domain';

import { cardVariants } from './card.js';
import { cn } from './class-names.js';
import { SeverityDot } from './severity.js';

export interface BountyCardProps extends Omit<ComponentPropsWithoutRef<'article'>, 'children'> {
  /** Replaces the default trailing affordance with a real control (a `Button`, a router `Link`). */
  action?: ReactNode;
  /** Accessible name of the card-wide link rendered when `href` is set. */
  actionLabel?: string;
  /** Scope summary under the program name, e.g. `Smart contracts · Ethereum`. */
  assetSummary: string;
  escrowFunded?: boolean;
  /** Pre-formatted pool figure, e.g. `185,000 USDC`. Formatting belongs to the caller. */
  escrowPool: string;
  escrowStatusLabel?: string;
  /** Turns the whole card into one link target instead of a nested control. */
  href?: string;
  /** Pre-formatted reward ceiling, e.g. `$250K`. */
  maxBounty: string;
  programName: string;
  severity: Severity;
  tags?: readonly string[];
}

/**
 * Discovery card for escrow-funded programs — Figma `21:56`. Presentational only: every figure
 * arrives formatted, the card never fetches or derives anything.
 *
 * The severity signal is a dot *plus* an uppercase label, the surface stays neutral so a grid of
 * cards reads as one dashboard, and the trailing arrow is a decorative affordance: when `href` is
 * set the whole card is the hit target, which keeps the row free of nested interactive controls.
 */
export const BountyCard = forwardRef<HTMLElement, BountyCardProps>(function BountyCard(
  {
    action,
    actionLabel,
    assetSummary,
    className,
    escrowFunded = true,
    escrowPool,
    escrowStatusLabel,
    href,
    maxBounty,
    programName,
    severity,
    tags,
    ...cardProps
  },
  ref,
) {
  const escrowLabel = escrowStatusLabel ?? (escrowFunded ? 'Escrow funded' : 'Escrow pending');

  return (
    <article
      {...cardProps}
      ref={ref}
      data-severity={severity}
      className={cn(
        cardVariants({ padding: 'md', variant: 'elevated' }),
        'relative isolate overflow-hidden',
        className,
      )}
    >
      {/* Ambient glow from the design's top-right corner; decorative and never a hit target. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-none right-none h-3xl w-1/2 rounded-full bg-ambient blur-3xl"
      />

      <div className="flex items-center justify-between gap-md">
        <SeverityDot severity={severity} />
        <span
          className={
            escrowFunded
              ? 'inline-flex items-center rounded-full border border-escrow bg-surface-raised px-md py-xs text-label-sm font-semibold uppercase text-escrow'
              : 'inline-flex items-center rounded-full border border-border bg-surface-raised px-md py-xs text-label-sm font-semibold uppercase text-text-muted'
          }
        >
          {escrowLabel}
        </span>
      </div>

      <div className="flex flex-col gap-xs">
        <h3 className="text-h2">{programName}</h3>
        <p className="text-body-sm text-text-muted">{assetSummary}</p>
      </div>

      <div className="flex items-end justify-between gap-md">
        <div className="flex flex-col gap-xs">
          <span className="text-label-sm font-semibold uppercase text-text-muted">Max bounty</span>
          <span className="text-h1">{maxBounty}</span>
        </div>
        <div className="flex flex-col items-end gap-xs">
          <span className="text-label-sm font-semibold uppercase text-text-muted">Escrow pool</span>
          <span className="text-label-lg font-semibold text-escrow">{escrowPool}</span>
        </div>
      </div>

      <div aria-hidden="true" className="h-px w-full bg-border" />

      <div className="flex items-center justify-between gap-md">
        <ul className="flex flex-wrap items-center gap-sm">
          {(tags ?? []).map((tag) => (
            <li
              key={tag}
              className="inline-flex items-center rounded-full border border-border bg-surface-raised px-md py-xs text-label-sm font-semibold uppercase text-text-muted"
            >
              {tag}
            </li>
          ))}
        </ul>
        {action ?? (
          <span
            aria-hidden="true"
            className="flex size-2xl shrink-0 items-center justify-center rounded-full bg-primary text-primary-contrast"
          >
            <ArrowUpRight className="size-lg" />
          </span>
        )}
      </div>

      {href === undefined ? null : (
        <a href={href} className="absolute inset-none rounded-lg">
          <span className="sr-only">{actionLabel ?? `View ${programName}`}</span>
        </a>
      )}
    </article>
  );
});
