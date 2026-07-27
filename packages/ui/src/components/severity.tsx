import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import type { Severity } from '@bug-bounty-escrow/domain';

import { cn } from './class-names.js';

/**
 * Severity is the loudest signal in the product, so it is never carried by colour alone: every
 * surface below renders the dot *and* the label. Figma `21:56 → Severity Signal` uses an 8px dot,
 * an 8px gap and an uppercase label in the severity colour.
 */
export const SEVERITY_LABELS: Readonly<Record<Severity, string>> = Object.freeze({
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  informational: 'Informational',
});

/**
 * Tone classes are split by CSS property on purpose. `cn()` merges through tailwind-merge, which
 * treats every unknown `text-*` class as a colour, so a size token and a colour token must never
 * meet in the same merged string — the colour would silently delete the size.
 */
const SEVERITY_TEXT: Readonly<Record<Severity, string>> = Object.freeze({
  critical: 'text-critical',
  high: 'text-high',
  medium: 'text-medium',
  low: 'text-low',
  informational: 'text-informational',
});

const SEVERITY_BG: Readonly<Record<Severity, string>> = Object.freeze({
  critical: 'bg-critical',
  high: 'bg-high',
  medium: 'bg-medium',
  low: 'bg-low',
  informational: 'bg-informational',
});

const SEVERITY_BORDER: Readonly<Record<Severity, string>> = Object.freeze({
  critical: 'border-critical',
  high: 'border-high',
  medium: 'border-medium',
  low: 'border-low',
  informational: 'border-informational',
});

export interface SeverityDotProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** Overrides the default label. The label is always rendered; there is no dot-only mode. */
  label?: string;
  severity: Severity;
}

/**
 * Compact severity signal: coloured dot + label, centred, 8px gap. Create Program requires exactly
 * this pairing for reward tier rows.
 */
export const SeverityDot = forwardRef<HTMLSpanElement, SeverityDotProps>(function SeverityDot(
  { className, label, severity, ...dotProps },
  ref,
) {
  return (
    <span
      {...dotProps}
      ref={ref}
      data-severity={severity}
      className={cn(
        'inline-flex items-center justify-center gap-sm text-label-sm font-semibold uppercase',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn('size-sm shrink-0 rounded-full', SEVERITY_BG[severity])}
      />
      <span className={SEVERITY_TEXT[severity]}>{label ?? SEVERITY_LABELS[severity]}</span>
    </span>
  );
});

export interface SeverityBadgeProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** Overrides the default label. The label is always rendered. */
  label?: string;
  severity: Severity;
  /** The dot may be dropped in dense tables; the label never is. */
  showDot?: boolean;
}

/** Pill form of the severity signal, shaped like {@link StatusBadge} so ramps line up in a row. */
export const SeverityBadge = forwardRef<HTMLSpanElement, SeverityBadgeProps>(function SeverityBadge(
  { className, label, severity, showDot = true, ...badgeProps },
  ref,
) {
  return (
    <span
      {...badgeProps}
      ref={ref}
      data-severity={severity}
      className={cn(
        'inline-flex items-center justify-center gap-sm rounded-full border bg-surface-raised px-md py-sm text-label-sm font-semibold uppercase',
        SEVERITY_BORDER[severity],
        className,
      )}
    >
      {showDot ? (
        <span
          aria-hidden="true"
          className={cn('size-sm shrink-0 rounded-full', SEVERITY_BG[severity])}
        />
      ) : null}
      <span className={SEVERITY_TEXT[severity]}>{label ?? SEVERITY_LABELS[severity]}</span>
    </span>
  );
});
