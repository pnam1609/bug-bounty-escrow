'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from './class-names.js';

export interface LabelProps extends ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  /** Dims the label to match a disabled control. `Field` forwards its own `disabled` here. */
  disabled?: boolean | undefined;
  /** Renders the required marker and its screen-reader equivalent. */
  required?: boolean | undefined;
}

/**
 * Figma `04 · Variants & States → Input` (node 37:85) draws the field label as Label/Medium
 * (12/16, 500) in `--color-text`, dropping to `--color-text-disabled` when the control is
 * disabled. The default colour is inherited from the body, so no colour utility is needed here.
 */
export const Label = forwardRef<ComponentRef<typeof LabelPrimitive.Root>, LabelProps>(
  function Label({ children, className, disabled = false, required = false, ...labelProps }, ref) {
    return (
      <LabelPrimitive.Root
        {...labelProps}
        ref={ref}
        className={cn(
          'inline-flex items-center gap-xs text-label-md',
          'peer-disabled:cursor-not-allowed peer-disabled:text-text-disabled',
          // An arbitrary property rather than `text-text-disabled`: a plain colour utility would
          // share a tailwind-merge group with `text-label-md` and drop the font size.
          disabled && '[color:var(--color-text-disabled)]',
          className,
        )}
      >
        {children}
        {required ? (
          <>
            <span aria-hidden="true" className="text-error">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </LabelPrimitive.Root>
    );
  },
);
