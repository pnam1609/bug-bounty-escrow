'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import { cn } from './class-names.js';

export const INPUT_SIZES = Object.freeze(['md', 'lg'] as const);
export type InputSize = (typeof INPUT_SIZES)[number];

/**
 * Figma `04 · Variants & States → Input` (node 37:85): 2 sizes x 5 states
 * (Default / Hover / Focus / Error / Disabled).
 *
 * Only size is a cva key — the other four states are native pseudo-classes plus `aria-invalid`,
 * so the visual state can never drift from what assistive tech is told.
 */
export const inputVariants = cva(
  [
    'flex w-full items-center rounded-md border border-input-border bg-input text-body-sm',
    'placeholder:text-input-placeholder',
    'transition-colors motion-reduce:transition-none',
    'hover:border-border-brand',
    // Figma draws focus as a 2px violet border. Growing the border would reflow the field, so the
    // second pixel is an inset ring. The global :focus-visible outline in theme.css stays on top.
    'focus-visible:border-input-border-focus focus-visible:ring-1 focus-visible:ring-input-border-focus focus-visible:ring-inset',
    // Error is driven by aria-invalid rather than a separate boolean prop.
    'aria-[invalid=true]:border-error aria-[invalid=true]:hover:border-error',
    'aria-[invalid=true]:focus-visible:border-error aria-[invalid=true]:focus-visible:ring-error',
    'disabled:cursor-not-allowed disabled:border-input-border disabled:bg-surface-raised',
    'disabled:text-text-disabled disabled:placeholder:text-text-disabled',
    'disabled:hover:border-input-border',
  ],
  {
    variants: {
      size: {
        md: 'h-10 px-md',
        lg: 'h-12 px-lg',
      } satisfies Record<InputSize, string>,
    },
    defaultVariants: { size: 'md' },
  },
);

export interface InputProps
  extends Omit<ComponentPropsWithoutRef<'input'>, 'size'>,
    VariantProps<typeof inputVariants> {
  /** Control height. `md` is 40px, `lg` is 48px, per Figma. */
  size?: InputSize | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, size = 'md', type = 'text', ...inputProps },
  ref,
) {
  return (
    <input
      {...inputProps}
      ref={ref}
      className={cn(inputVariants({ size }), className)}
      type={type}
    />
  );
});
