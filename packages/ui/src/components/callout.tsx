import { CircleAlert, Info, ShieldCheck, TriangleAlert, type LucideIcon } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';

import { cn } from './class-names.js';

export const CALLOUT_VARIANTS = Object.freeze(['info', 'warning', 'danger', 'escrow'] as const);
export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

/** Lucide is the icon source of truth (Foundations `06 · Icons`); glyphs inherit semantic colour. */
const VARIANT_ICONS: Readonly<Record<CalloutVariant, LucideIcon>> = Object.freeze({
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  escrow: ShieldCheck,
});

const VARIANT_BORDER: Readonly<Record<CalloutVariant, string>> = Object.freeze({
  info: 'border-low',
  warning: 'border-medium',
  danger: 'border-error',
  escrow: 'border-escrow',
});

const VARIANT_TEXT: Readonly<Record<CalloutVariant, string>> = Object.freeze({
  info: 'text-low',
  warning: 'text-medium',
  danger: 'text-error',
  escrow: 'text-escrow',
});

/** A validation summary must interrupt; a standing privacy notice must not. */
const VARIANT_ROLES: Readonly<Record<CalloutVariant, 'alert' | 'note'>> = Object.freeze({
  info: 'note',
  warning: 'note',
  danger: 'alert',
  escrow: 'note',
});

/** `title` is the callout heading, so the native tooltip attribute of the same name is dropped. */
export interface CalloutProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Overrides the variant's Lucide glyph. The icon is decorative — the text always carries it. */
  icon?: LucideIcon;
  title?: ReactNode;
  variant?: CalloutVariant;
}

/**
 * Alert surface behind privacy notices, validation summaries and disclosure warnings.
 *
 * Icon and text always ship together: the glyph is `aria-hidden`, so meaning lives in the copy and
 * in the role, never in the hue alone.
 */
export const Callout = forwardRef<HTMLDivElement, CalloutProps>(function Callout(
  { children, className, icon, role, title, variant = 'info', ...calloutProps },
  ref,
) {
  const Icon = icon ?? VARIANT_ICONS[variant];

  return (
    <div
      {...calloutProps}
      ref={ref}
      role={role ?? VARIANT_ROLES[variant]}
      data-variant={variant}
      className={cn(
        'flex items-start gap-md rounded-md border bg-surface-raised p-lg text-body-sm',
        VARIANT_BORDER[variant],
        className,
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-xs size-lg shrink-0', VARIANT_TEXT[variant])} />
      <div className="flex min-w-0 flex-col gap-xs">
        {title === undefined ? null : (
          <p className={`text-label-lg font-semibold ${VARIANT_TEXT[variant]}`}>{title}</p>
        )}
        <div className="text-body-sm text-text">{children}</div>
      </div>
    </div>
  );
});
