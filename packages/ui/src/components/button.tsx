'use client';

import { Slot, Slottable } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementType } from 'react';

import { cn } from './class-names.js';

export const BUTTON_VARIANTS = Object.freeze(['primary', 'secondary', 'ghost'] as const);
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

export const BUTTON_SIZES = Object.freeze(['md', 'lg'] as const);
export type ButtonSize = (typeof BUTTON_SIZES)[number];

/**
 * Figma `04 · Variants & States → Button` (node 24:45) ships 18 variants — 2 sizes x 3 styles x
 * 3 states. Hover and disabled are pseudo-class driven here, so only size and style are cva keys.
 *
 * A note on the `[color:var(--token)]` escapes below: `tailwind-merge` files BBE's type tokens
 * (`text-label-lg`) and BBE's colour tokens (`text-primary-contrast`) into the same conflict
 * group, so writing both in one `cn()` call silently drops the font size. Static colours are
 * therefore written as arbitrary properties, which still point at the token but merge on their
 * own. Variant-scoped colours (`disabled:text-*`) are already in a distinct group and stay plain.
 */
export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-sm',
    'rounded-full text-label-lg font-semibold whitespace-nowrap',
    'transition-colors motion-reduce:transition-none',
    // Figma dims the whole disabled button to 42% rather than recolouring it.
    'disabled:cursor-not-allowed disabled:opacity-[0.42]',
    'aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-[0.42]',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary [color:var(--color-primary-contrast)] hover:bg-primary-hover',
        // Secondary and ghost keep the inherited body colour, which is already `--color-text`.
        secondary: 'border border-border bg-surface-raised hover:border-border-brand',
        ghost: 'hover:bg-surface-raised disabled:text-text-muted aria-disabled:text-text-muted',
      } satisfies Record<ButtonVariant, string>,
      size: {
        // 12 + 20 line-height + 12 = the 44px minimum target height, exactly as drawn.
        md: 'px-lg py-md',
        lg: 'px-xl py-lg',
      } satisfies Record<ButtonSize, string>,
    },
    defaultVariants: { size: 'md', variant: 'primary' },
  },
);

/** The spinner sits on a transparent-text button, so it carries its own colour. */
const BUTTON_SPINNER_COLORS: Readonly<Record<ButtonVariant, string>> = Object.freeze({
  primary: '[color:var(--color-primary-contrast)]',
  secondary: '[color:var(--color-text)]',
  ghost: '[color:var(--color-text)]',
});

export interface ButtonProps
  extends ComponentPropsWithoutRef<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the single child as the button — e.g. to wrap a Next `<Link>`. */
  asChild?: boolean | undefined;
  /** Disables the button and swaps the label for a spinner without changing its width. */
  loading?: boolean | undefined;
  /** Announced to screen readers while `loading` is true. */
  loadingLabel?: string | undefined;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    asChild = false,
    children,
    className,
    disabled = false,
    loading = false,
    loadingLabel = 'Loading',
    size = 'md',
    type = 'button',
    variant = 'primary',
    ...buttonProps
  },
  ref,
) {
  // `ElementType` keeps the union of `Slot | 'button'` assignable in one JSX position; the public
  // surface stays fully typed through `ButtonProps`.
  const Comp: ElementType = asChild ? Slot : 'button';
  const isDisabled = disabled || loading;

  return (
    <Comp
      {...buttonProps}
      ref={ref}
      aria-busy={loading || undefined}
      // An `asChild` button may render an <a>, which has no `disabled` attribute.
      aria-disabled={asChild && isDisabled ? true : undefined}
      className={cn(
        buttonVariants({ size, variant }),
        // Hiding the label in place — rather than replacing it — is what keeps the width stable,
        // so a button entering the loading state never reflows the action row it sits in.
        loading && '[color:transparent]',
        className,
      )}
      data-loading={loading ? '' : undefined}
      data-variant={variant}
      disabled={asChild ? undefined : isDisabled}
      type={asChild ? undefined : type}
    >
      <Slottable>{children}</Slottable>
      {loading ? (
        <span
          className={`pointer-events-none absolute inset-0 flex items-center justify-center ${BUTTON_SPINNER_COLORS[variant]}`}
        >
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          <span className="sr-only">{loadingLabel}</span>
        </span>
      ) : null}
    </Comp>
  );
});
