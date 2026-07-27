'use client';

import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from './class-names.js';

/*
 * Hairline rule at the `border` token — the same line the header, footer and tab strip in node
 * 162:95 / 44:19 draw. Decorative by default; pass `decorative={false}` when the rule genuinely
 * separates two groups and should be announced.
 */

export const SEPARATOR_ORIENTATIONS = Object.freeze(['horizontal', 'vertical'] as const);
export type SeparatorOrientation = (typeof SEPARATOR_ORIENTATIONS)[number];

const separatorVariants = cva('shrink-0 bg-border', {
  variants: {
    orientation: {
      horizontal: 'h-px w-full',
      vertical: 'h-full w-px',
    },
  },
  defaultVariants: {
    orientation: 'horizontal',
  },
});

export type SeparatorVariants = VariantProps<typeof separatorVariants>;

export type SeparatorProps = ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>;

export const Separator = forwardRef<ComponentRef<typeof SeparatorPrimitive.Root>, SeparatorProps>(
  function Separator(
    { className, decorative = true, orientation = 'horizontal', ...separatorProps },
    ref,
  ) {
    return (
      <SeparatorPrimitive.Root
        {...separatorProps}
        ref={ref}
        decorative={decorative}
        orientation={orientation}
        className={cn(separatorVariants({ orientation }), className)}
      />
    );
  },
);
