'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from './class-names.js';

/**
 * Tooltip — a supplement, never a source of truth.
 *
 * From `06 · Icons → 04 · Accessibility`: an important icon action always carries a label or a
 * tooltip, and meaning is never conveyed by colour alone. The inverse is just as binding: a
 * tooltip must never be the only way to read a value. Tooltips do not open on touch, do not
 * appear for keyboard users who tab past quickly, and are invisible to anyone reading a printed
 * or exported view.
 *
 * So: put the full value in the accessible name or in visible copy, and let the tooltip repeat
 * it. The bounty table does exactly this — the cell shows `250K USDC`, the accessible label
 * carries the full amount, and the tooltip merely echoes it. Where a figure is private, render
 * the word `Private` with an accessible label; do not hang the real number in a tooltip.
 *
 * Menu-weight elevation (`shadow-elevated`), matching the other transient surfaces.
 */

/**
 * `enter` / `exit` keyframes come from `tw-animate-css`, imported at the top of `theme.css`.
 *
 * `motion-reduce:animate-none!` is important on purpose: `animate-in` and `animate-none` share a
 * utility namespace, so the `!` guarantees reduced motion wins regardless of Tailwind's ordering.
 * It also resolves `animation-name` to `none`, which tells Radix to unmount immediately instead
 * of waiting on an exit keyframe that will never run.
 */
const SURFACE_MOTION = [
  'origin-[var(--radix-tooltip-content-transform-origin)] duration-150',
  'data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0',
  'data-[state=delayed-open]:zoom-in-95',
  'data-[state=instant-open]:animate-in data-[state=instant-open]:fade-in-0',
  'data-[state=instant-open]:zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
  'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
  'motion-reduce:animate-none!',
];

export type TooltipProviderProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Provider>;

/**
 * Wrap the app (or at least each screen) once. Radix needs a provider in scope for every
 * tooltip, and it is what shares the "skip delay" window between neighbouring triggers.
 */
export function TooltipProvider({
  delayDuration = 200,
  skipDelayDuration = 300,
  ...providerProps
}: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider
      {...providerProps}
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
    />
  );
}

export const Tooltip = TooltipPrimitive.Root;
export type TooltipProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>;

export const TooltipTrigger = TooltipPrimitive.Trigger;
export type TooltipTriggerProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>;

export const TooltipPortal = TooltipPrimitive.Portal;
export type TooltipPortalProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Portal>;

export type TooltipArrowProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Arrow>;

export const TooltipArrow = forwardRef<
  ComponentRef<typeof TooltipPrimitive.Arrow>,
  TooltipArrowProps
>(function TooltipArrow({ className, ...arrowProps }, ref) {
  return (
    <TooltipPrimitive.Arrow
      {...arrowProps}
      ref={ref}
      className={cn('fill-surface-raised', className)}
    />
  );
});

export interface TooltipContentProps
  extends ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> {
  /** Render the pointer notch back towards the trigger. */
  showArrow?: boolean;
}

export const TooltipContent = forwardRef<
  ComponentRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(function TooltipContent(
  { children, className, collisionPadding = 8, showArrow = true, sideOffset = 8, ...contentProps },
  ref,
) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        {...contentProps}
        ref={ref}
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-[16rem]',
          'rounded-sm border border-border bg-surface-raised px-md py-sm text-label-md text-text',
          'shadow-elevated',
          SURFACE_MOTION,
          className,
        )}
      >
        {children}
        {showArrow ? <TooltipArrow /> : null}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});
