'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
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
 * Modal dialog — Figma `98:527` "Dialog Overlay" → `98:528` "Dialog / Add scope item".
 *
 * The scope editor is the reference usage: a 640px surface on `--bbe-modal-bg` (= surface/raised)
 * with a 1px border, Shadow/Overlay and a right-aligned Cancel / confirm action row, floating on a
 * 60% black scrim.
 *
 * Focus trap, scroll lock, `Escape` to dismiss and return-focus to the trigger are Radix
 * behaviours. They are deliberately left at their defaults — never pass `onEscapeKeyDown` or
 * `onCloseAutoFocus` handlers that swallow the event.
 */

/**
 * Radix drives `data-state` on both the scrim and the surface; the `enter` / `exit` keyframes come
 * from `tw-animate-css`, imported at the top of `theme.css`.
 *
 * `motion-reduce:animate-none!` is important on purpose: `animate-in` and `animate-none` live in
 * the same utility namespace, so the `!` is what guarantees reduced motion wins no matter how
 * Tailwind orders the two. It also resolves the computed `animation-name` to `none`, which is the
 * signal Radix uses to skip the exit animation and unmount immediately rather than waiting on a
 * keyframe that will never run.
 */
const OVERLAY_MOTION = [
  'duration-200',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
  'motion-reduce:animate-none!',
];

const SURFACE_MOTION = [
  'duration-200',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
  'motion-reduce:animate-none!',
];

export const DIALOG_SIZES = Object.freeze(['sm', 'md', 'lg'] as const);
export type DialogSize = (typeof DIALOG_SIZES)[number];

export const dialogContentVariants = cva(
  [
    'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
    'flex w-[calc(100%-2rem)] max-h-[calc(100svh-2rem)] flex-col gap-lg overflow-y-auto',
    'rounded-lg border border-border bg-surface-raised p-xl text-text shadow-overlay',
    SURFACE_MOTION,
  ],
  {
    variants: {
      size: {
        /** Compact prompts and single-field edits. */
        sm: 'max-w-[30rem]',
        /** Default — the 640px scope editor from Figma. */
        md: 'max-w-[40rem]',
        /** Wide review surfaces such as a report diff. */
        lg: 'max-w-[56rem]',
      },
    },
    defaultVariants: {
      size: 'md',
    },
  },
);

export const Dialog = DialogPrimitive.Root;
export type DialogProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Root>;

export const DialogTrigger = DialogPrimitive.Trigger;
export type DialogTriggerProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>;

export const DialogPortal = DialogPrimitive.Portal;
export type DialogPortalProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>;

export const DialogClose = DialogPrimitive.Close;
export type DialogCloseProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Close>;

export type DialogOverlayProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>;

export const DialogOverlay = forwardRef<
  ComponentRef<typeof DialogPrimitive.Overlay>,
  DialogOverlayProps
>(function DialogOverlay({ className, ...overlayProps }, ref) {
  return (
    <DialogPrimitive.Overlay
      {...overlayProps}
      ref={ref}
      className={cn('fixed inset-0 z-50 bg-black/60', OVERLAY_MOTION, className)}
    />
  );
});

export interface DialogContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {
  /** Accessible name for the built-in close affordance. */
  closeLabel?: string;
  /** Classes for the scrim, which is rendered by this component. */
  overlayClassName?: string;
  /**
   * Render the top-right close button. Off by default: the Figma scope editor (`98:528`)
   * dismisses through its Cancel button, so an X would be extra chrome the design does not have.
   * `Escape` and the scrim still close the dialog either way.
   */
  showCloseButton?: boolean;
}

export const DialogContent = forwardRef<
  ComponentRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(function DialogContent(
  {
    children,
    className,
    closeLabel = 'Close dialog',
    overlayClassName,
    showCloseButton = false,
    size,
    ...contentProps
  },
  ref,
) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        {...contentProps}
        ref={ref}
        className={cn('relative', dialogContentVariants({ size }), className)}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close
            className={cn(
              'absolute right-md top-md inline-flex size-11 items-center justify-center rounded-full',
              'text-text-muted transition-colors hover:bg-ambient hover:text-text',
              'motion-reduce:transition-none',
            )}
          >
            <X aria-hidden="true" className="size-5" />
            {/* The glyph alone is not an accessible name; icon actions always carry a label. */}
            <span className="sr-only">{closeLabel}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export type DialogHeaderProps = HTMLAttributes<HTMLDivElement>;

export const DialogHeader = forwardRef<HTMLDivElement, DialogHeaderProps>(
  function DialogHeader({ className, ...headerProps }, ref) {
    return (
      <div
        {...headerProps}
        ref={ref}
        // The right inset keeps a long title clear of the absolutely positioned close button.
        className={cn('flex flex-col gap-sm pr-2xl text-left', className)}
      />
    );
  },
);

export type DialogTitleProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;

export const DialogTitle = forwardRef<ComponentRef<typeof DialogPrimitive.Title>, DialogTitleProps>(
  function DialogTitle({ className, ...titleProps }, ref) {
    return (
      <DialogPrimitive.Title
        {...titleProps}
        ref={ref}
        className={cn('text-h2 text-text', className)}
      />
    );
  },
);

export type DialogDescriptionProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Description>;

export const DialogDescription = forwardRef<
  ComponentRef<typeof DialogPrimitive.Description>,
  DialogDescriptionProps
>(function DialogDescription({ className, ...descriptionProps }, ref) {
  return (
    <DialogPrimitive.Description
      {...descriptionProps}
      ref={ref}
      className={cn('text-body-sm text-text-muted', className)}
    />
  );
});

export type DialogFooterProps = HTMLAttributes<HTMLDivElement>;

export const DialogFooter = forwardRef<HTMLDivElement, DialogFooterProps>(
  function DialogFooter({ className, ...footerProps }, ref) {
    return (
      <div
        {...footerProps}
        ref={ref}
        className={cn(
          // Actions stay in flow and never overlay the fields above them.
          'mt-auto flex flex-col-reverse gap-md pt-md sm:flex-row sm:items-center sm:justify-end',
          className,
        )}
      />
    );
  },
);
