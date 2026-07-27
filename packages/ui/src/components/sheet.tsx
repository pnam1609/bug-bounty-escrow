'use client';

import * as SheetPrimitive from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
} from 'react';

import { cn } from './class-names.js';

/**
 * Edge-anchored sheet, built on `@radix-ui/react-dialog` so it inherits the same focus trap,
 * scroll lock, `Escape` handling and return-focus as `Dialog`.
 *
 * The reference usage is `BT-10 · Mobile filters`: below the table's desktop breakpoint the
 * `Filters` button opens a full-width **bottom** sheet holding every filter group, with a sticky
 * footer carrying `Clear all` and `Show 24 bounties`. Filters on mobile are applied once, from
 * that footer — which is why the footer must never scroll out of reach.
 *
 * Compose it as `SheetHeader` + `SheetBody` + `SheetFooter`: the body is the scroll container and
 * the footer is pinned after it. `SheetFooter` is also `sticky bottom-0`, so it stays pinned even
 * when a caller skips `SheetBody` and lets the whole panel scroll.
 *
 * A sheet is a modal surface, so it carries `shadow-overlay`, not the lighter `shadow-elevated`.
 */

/**
 * `enter` / `exit` keyframes come from `tw-animate-css`, imported at the top of `theme.css`. The
 * directional half lives on each `side` variant below, so a bottom sheet rises from the bottom
 * edge and returns the way it came.
 *
 * `motion-reduce:animate-none!` is important on purpose: `animate-in` and `animate-none` share a
 * utility namespace, so the `!` guarantees reduced motion wins regardless of Tailwind's ordering
 * — a reduced-motion user gets no slide at all, just presence. It also resolves `animation-name`
 * to `none`, which tells Radix to unmount immediately instead of waiting on an exit keyframe that
 * will never run.
 */
const OVERLAY_MOTION = [
  'duration-200',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
  'motion-reduce:animate-none!',
];

const SURFACE_MOTION = [
  'duration-300',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
  'motion-reduce:animate-none!',
];

export const SHEET_SIDES = Object.freeze(['top', 'right', 'bottom', 'left'] as const);
export type SheetSide = (typeof SHEET_SIDES)[number];

export const sheetContentVariants = cva(
  [
    'fixed z-50 flex flex-col overflow-y-auto',
    'border-border bg-surface-raised text-text shadow-overlay',
    SURFACE_MOTION,
  ],
  {
    variants: {
      side: {
        top: [
          'inset-x-0 top-0 max-h-[85svh] rounded-b-lg border-b',
          'data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
        ],
        right: [
          'inset-y-0 right-0 h-full w-[min(24rem,calc(100%-3rem))] rounded-l-lg border-l',
          'data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        ],
        /** Mobile filter panel — full width, pinned to the bottom edge. */
        bottom: [
          'inset-x-0 bottom-0 max-h-[85svh] rounded-t-lg border-t',
          'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
        ],
        left: [
          'inset-y-0 left-0 h-full w-[min(24rem,calc(100%-3rem))] rounded-r-lg border-r',
          'data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        ],
      },
    },
    defaultVariants: {
      side: 'right',
    },
  },
);

export const Sheet = SheetPrimitive.Root;
export type SheetProps = ComponentPropsWithoutRef<typeof SheetPrimitive.Root>;

export const SheetTrigger = SheetPrimitive.Trigger;
export type SheetTriggerProps = ComponentPropsWithoutRef<typeof SheetPrimitive.Trigger>;

export const SheetPortal = SheetPrimitive.Portal;
export type SheetPortalProps = ComponentPropsWithoutRef<typeof SheetPrimitive.Portal>;

export const SheetClose = SheetPrimitive.Close;
export type SheetCloseProps = ComponentPropsWithoutRef<typeof SheetPrimitive.Close>;

export type SheetOverlayProps = ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>;

export const SheetOverlay = forwardRef<
  ComponentRef<typeof SheetPrimitive.Overlay>,
  SheetOverlayProps
>(function SheetOverlay({ className, ...overlayProps }, ref) {
  return (
    <SheetPrimitive.Overlay
      {...overlayProps}
      ref={ref}
      className={cn('fixed inset-0 z-50 bg-black/60', OVERLAY_MOTION, className)}
    />
  );
});

export interface SheetContentProps
  extends ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetContentVariants> {
  /** Accessible name for the built-in close affordance. */
  closeLabel?: string;
  /** Classes for the scrim, which is rendered by this component. */
  overlayClassName?: string;
  /** Render the top-right close button. */
  showCloseButton?: boolean;
}

export const SheetContent = forwardRef<
  ComponentRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(function SheetContent(
  {
    children,
    className,
    closeLabel = 'Close panel',
    overlayClassName,
    showCloseButton = true,
    side,
    ...contentProps
  },
  ref,
) {
  return (
    <SheetPortal>
      <SheetOverlay className={overlayClassName} />
      <SheetPrimitive.Content
        {...contentProps}
        ref={ref}
        className={cn(sheetContentVariants({ side }), className)}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            className={cn(
              'absolute right-md top-md inline-flex size-11 items-center justify-center rounded-full',
              'text-text-muted transition-colors hover:bg-ambient hover:text-text',
              'motion-reduce:transition-none',
            )}
          >
            <X aria-hidden="true" className="size-5" />
            {/* The glyph alone is not an accessible name; icon actions always carry a label. */}
            <span className="sr-only">{closeLabel}</span>
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
});

export type SheetHeaderProps = HTMLAttributes<HTMLDivElement>;

export const SheetHeader = forwardRef<HTMLDivElement, SheetHeaderProps>(
  function SheetHeader({ className, ...headerProps }, ref) {
    return (
      <div
        {...headerProps}
        ref={ref}
        // The right inset keeps a long title clear of the absolutely positioned close button.
        className={cn(
          'flex shrink-0 flex-col gap-sm border-b border-border p-xl pr-2xl text-left',
          className,
        )}
      />
    );
  },
);

export type SheetTitleProps = ComponentPropsWithoutRef<typeof SheetPrimitive.Title>;

export const SheetTitle = forwardRef<ComponentRef<typeof SheetPrimitive.Title>, SheetTitleProps>(
  function SheetTitle({ className, ...titleProps }, ref) {
    return (
      <SheetPrimitive.Title
        {...titleProps}
        ref={ref}
        className={cn('text-h3 text-text', className)}
      />
    );
  },
);

export type SheetDescriptionProps = ComponentPropsWithoutRef<typeof SheetPrimitive.Description>;

export const SheetDescription = forwardRef<
  ComponentRef<typeof SheetPrimitive.Description>,
  SheetDescriptionProps
>(function SheetDescription({ className, ...descriptionProps }, ref) {
  return (
    <SheetPrimitive.Description
      {...descriptionProps}
      ref={ref}
      className={cn('text-body-sm text-text-muted', className)}
    />
  );
});

export type SheetBodyProps = HTMLAttributes<HTMLDivElement>;

/** The scroll region between header and footer. `min-h-0` is what lets it actually shrink. */
export const SheetBody = forwardRef<HTMLDivElement, SheetBodyProps>(
  function SheetBody({ className, ...bodyProps }, ref) {
    return (
      <div
        {...bodyProps}
        ref={ref}
        className={cn('flex min-h-0 flex-1 flex-col gap-xl overflow-y-auto p-xl', className)}
      />
    );
  },
);

export type SheetFooterProps = HTMLAttributes<HTMLDivElement>;

/**
 * Pinned action row. `mt-auto` holds it to the bottom edge of a short sheet, `sticky bottom-0`
 * holds it in view when the panel itself is the scroll container, and the padding floor clears
 * the iOS home indicator on a bottom sheet.
 */
export const SheetFooter = forwardRef<HTMLDivElement, SheetFooterProps>(
  function SheetFooter({ className, ...footerProps }, ref) {
    return (
      <div
        {...footerProps}
        ref={ref}
        className={cn(
          'sticky bottom-0 z-10 mt-auto flex shrink-0 flex-col-reverse gap-md',
          'border-t border-border bg-surface-raised px-xl pt-xl',
          'pb-[max(var(--spacing-xl),env(safe-area-inset-bottom))]',
          'sm:flex-row sm:items-center sm:justify-end',
          className,
        )}
      />
    );
  },
);
