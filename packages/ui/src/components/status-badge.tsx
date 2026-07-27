import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import type { ProgramStatus, ReportStatus } from '@bug-bounty-escrow/domain';

import { cn } from './class-names.js';

/**
 * Tones, not statuses. Figma `26:25` gives six report/payment states their own hue; program
 * lifecycle reuses the same ramp so a dashboard mixing both reads as one system.
 */
export const STATUS_BADGE_VARIANTS = Object.freeze([
  'neutral',
  'info',
  'warning',
  'attention',
  'danger',
  'success',
  'escrow',
  'usdc',
] as const);

export type StatusBadgeVariant = (typeof STATUS_BADGE_VARIANTS)[number];

/**
 * Colour is split per CSS property: `cn()` merges through tailwind-merge, which reads every unknown
 * `text-*` class as a colour, so the type token on the root and the tone token on the label must
 * live on different elements or the tone would silently delete the size.
 */
const TONE_TEXT: Readonly<Record<StatusBadgeVariant, string>> = Object.freeze({
  neutral: 'text-text-muted',
  info: 'text-low',
  warning: 'text-medium',
  attention: 'text-high',
  danger: 'text-error',
  success: 'text-success',
  escrow: 'text-escrow',
  usdc: 'text-usdc',
});

const TONE_BORDER: Readonly<Record<StatusBadgeVariant, string>> = Object.freeze({
  neutral: 'border-border',
  info: 'border-low',
  warning: 'border-medium',
  attention: 'border-high',
  danger: 'border-error',
  success: 'border-success',
  escrow: 'border-escrow',
  usdc: 'border-usdc',
});

const TONE_BG: Readonly<Record<StatusBadgeVariant, string>> = Object.freeze({
  neutral: 'bg-text-muted',
  info: 'bg-low',
  warning: 'bg-medium',
  attention: 'bg-high',
  danger: 'bg-error',
  success: 'bg-success',
  escrow: 'bg-escrow',
  usdc: 'bg-usdc',
});

export const REPORT_STATUS_LABELS: Readonly<Record<ReportStatus, string>> = Object.freeze({
  draft: 'Draft',
  submitted: 'Submitted',
  triaged: 'Triaged',
  needs_information: 'Needs information',
  rejected: 'Rejected',
  duplicate: 'Duplicate',
  validated: 'Validated',
  reward_approved: 'Reward approved',
  payment_pending: 'Payment pending',
  paid: 'Paid',
});

/** Mint stays reserved for escrow and completed states; USDC blue only for money in flight. */
const REPORT_STATUS_TONES: Readonly<Record<ReportStatus, StatusBadgeVariant>> = Object.freeze({
  draft: 'neutral',
  submitted: 'info',
  triaged: 'warning',
  needs_information: 'attention',
  rejected: 'danger',
  duplicate: 'neutral',
  validated: 'escrow',
  reward_approved: 'escrow',
  payment_pending: 'usdc',
  paid: 'success',
});

export const PROGRAM_STATUS_LABELS: Readonly<Record<ProgramStatus, string>> = Object.freeze({
  draft: 'Draft',
  awaiting_funding: 'Awaiting funding',
  active: 'Active',
  paused: 'Paused',
  expired: 'Expired',
  closed: 'Closed',
});

const PROGRAM_STATUS_TONES: Readonly<Record<ProgramStatus, StatusBadgeVariant>> = Object.freeze({
  draft: 'neutral',
  awaiting_funding: 'warning',
  active: 'success',
  paused: 'attention',
  expired: 'neutral',
  closed: 'neutral',
});

interface StatusBadgeBaseProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  /** Overrides the domain label. The label is always rendered — never colour alone. */
  label?: string;
  /** The dot may be dropped in dense tables; the label never is. */
  showDot?: boolean;
  /** Escape hatch for a status the ramp does not cover yet. */
  variant?: StatusBadgeVariant;
}

export interface ReportStatusBadgeProps extends StatusBadgeBaseProps {
  kind?: 'report';
  status: ReportStatus;
}

export interface ProgramStatusBadgeProps extends StatusBadgeBaseProps {
  kind: 'program';
  status: ProgramStatus;
}

/** `draft` exists in both lifecycles, so `kind` discriminates instead of a widened union. */
export type StatusBadgeProps = ProgramStatusBadgeProps | ReportStatusBadgeProps;

function resolveStatus(props: StatusBadgeProps): { label: string; tone: StatusBadgeVariant } {
  if (props.kind === 'program') {
    return { label: PROGRAM_STATUS_LABELS[props.status], tone: PROGRAM_STATUS_TONES[props.status] };
  }

  return { label: REPORT_STATUS_LABELS[props.status], tone: REPORT_STATUS_TONES[props.status] };
}

export const StatusBadge = forwardRef<HTMLSpanElement, StatusBadgeProps>(
  function StatusBadge(props, ref) {
    const resolved = resolveStatus(props);
    const {
      className,
      kind = 'report',
      label = resolved.label,
      showDot = true,
      status,
      variant = resolved.tone,
      ...badgeProps
    } = props;

    return (
      <span
        {...badgeProps}
        ref={ref}
        data-kind={kind}
        data-status={status}
        data-variant={variant}
        className={cn(
          'inline-flex items-center justify-center gap-sm rounded-full border bg-surface-raised px-md py-sm text-label-sm font-semibold uppercase',
          TONE_BORDER[variant],
          className,
        )}
      >
        {showDot ? (
          <span
            aria-hidden="true"
            className={cn('size-sm shrink-0 rounded-full', TONE_BG[variant])}
          />
        ) : null}
        <span className={TONE_TEXT[variant]}>{label}</span>
      </span>
    );
  },
);
