'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef } from 'react';

import { cn } from './class-names.js';

export const TEXTAREA_SIZES = Object.freeze(['md', 'lg'] as const);
export type TextareaSize = (typeof TEXTAREA_SIZES)[number];

/**
 * Figma has no dedicated textarea node, so this mirrors the Input recipe from node 37:85 — same
 * radius, surface, border and five states — and only swaps the fixed height for a min-height that
 * grows with the content.
 */
export const textareaVariants = cva(
  [
    'block w-full resize-y rounded-md border border-input-border bg-input text-body-sm',
    'placeholder:text-input-placeholder',
    'transition-colors motion-reduce:transition-none',
    'hover:border-border-brand',
    'focus-visible:border-input-border-focus focus-visible:ring-1 focus-visible:ring-input-border-focus focus-visible:ring-inset',
    'aria-[invalid=true]:border-error aria-[invalid=true]:hover:border-error',
    'aria-[invalid=true]:focus-visible:border-error aria-[invalid=true]:focus-visible:ring-error',
    'disabled:cursor-not-allowed disabled:resize-none disabled:border-input-border',
    'disabled:bg-surface-raised disabled:text-text-disabled disabled:placeholder:text-text-disabled',
    'disabled:hover:border-input-border',
  ],
  {
    variants: {
      size: {
        // Horizontal padding matches the equivalent Input size; vertical padding keeps the first
        // line sitting on the same optical baseline as a single-line control.
        md: 'min-h-20 px-md py-sm',
        lg: 'min-h-28 px-lg py-md',
      } satisfies Record<TextareaSize, string>,
    },
    defaultVariants: { size: 'md' },
  },
);

export interface TextareaProps
  extends Omit<ComponentPropsWithoutRef<'textarea'>, 'size'>,
    VariantProps<typeof textareaVariants> {
  size?: TextareaSize | undefined;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, rows = 3, size = 'md', ...textareaProps },
  ref,
) {
  return (
    <textarea
      {...textareaProps}
      ref={ref}
      className={cn(textareaVariants({ size }), className)}
      rows={rows}
    />
  );
});
