'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from './class-names.js';

/**
 * Anchored popover — the bounty-table filter surface (`BT-03 · Filter popover`).
 *
 * Each desktop toolbar filter (`Status`, `Asset type`, `Max bounty`, `More filters`) is a
 * secondary Button that opens one of these directly beneath itself, holding a values search
 * input, a scrollable checkbox list and an `Apply` / `Clear selected` row. It therefore defaults
 * to `side="bottom" align="start"` so the panel's leading edge lines up with its trigger, and it
 * caps its own height against the space Radix measures below the trigger rather than growing off
 * screen.
 *
 * Menu-weight elevation (`shadow-elevated`), not the heavier modal `shadow-overlay`.
 */

/**
 * `enter` / `exit` keyframes come from `tw-animate-css`, imported at the top of `theme.css`. The
 * panel grows out of the corner nearest its trigger and drifts in from whichever side Radix
 * actually placed it on after collision handling.
 *
 * `motion-reduce:animate-none!` is important on purpose: `animate-in` and `animate-none` share a
 * utility namespace, so the `!` guarantees reduced motion wins regardless of Tailwind's ordering.
 * It also resolves `animation-name` to `none`, which tells Radix to unmount immediately instead
 * of waiting on an exit keyframe that will never run.
 */
const SURFACE_MOTION = [
  'origin-[var(--radix-popover-content-transform-origin)] duration-150',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
  'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
  'motion-reduce:animate-none!',
];

export const Popover = PopoverPrimitive.Root;
export type PopoverProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>;

export const PopoverTrigger = PopoverPrimitive.Trigger;
export type PopoverTriggerProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>;

export const PopoverAnchor = PopoverPrimitive.Anchor;
export type PopoverAnchorProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Anchor>;

export const PopoverPortal = PopoverPrimitive.Portal;
export type PopoverPortalProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Portal>;

export const PopoverClose = PopoverPrimitive.Close;
export type PopoverCloseProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Close>;

export type PopoverContentProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>;

export const PopoverContent = forwardRef<
  ComponentRef<typeof PopoverPrimitive.Content>,
  PopoverContentProps
>(function PopoverContent(
  { align = 'start', className, collisionPadding = 8, side = 'bottom', sideOffset = 8, ...contentProps },
  ref,
) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        {...contentProps}
        ref={ref}
        align={align}
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
        className={cn(
          'z-50 w-[18rem] max-w-[calc(100vw-2rem)]',
          'rounded-md border border-border bg-surface-raised p-lg text-text shadow-elevated',
          'max-h-[var(--radix-popover-content-available-height)] overflow-y-auto',
          SURFACE_MOTION,
          className,
        )}
      />
    </PopoverPrimitive.Portal>
  );
});

export type PopoverArrowProps = ComponentPropsWithoutRef<typeof PopoverPrimitive.Arrow>;

export const PopoverArrow = forwardRef<
  ComponentRef<typeof PopoverPrimitive.Arrow>,
  PopoverArrowProps
>(function PopoverArrow({ className, ...arrowProps }, ref) {
  return (
    <PopoverPrimitive.Arrow
      {...arrowProps}
      ref={ref}
      className={cn('fill-surface-raised', className)}
    />
  );
});
