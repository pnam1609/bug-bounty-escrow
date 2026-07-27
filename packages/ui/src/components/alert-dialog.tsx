'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
} from 'react';

import { cn } from './class-names.js';

/**
 * Destructive confirmation — Figma `101:564` "Alert Dialog Overlay" → `101:565`
 * "AlertDialog / Discard draft".
 *
 * A 520px surface on `--bbe-modal-bg` (= surface/raised) with Shadow/Overlay, a red-bordered
 * "cannot be undone" panel and a `Keep editing` / `Discard draft` action row. This is the
 * component behind "Discard draft" (owner create-program) and "Discard local draft"
 * (researcher submit-bug, SR-10).
 *
 * Unlike `Dialog` there is no close affordance and no dismiss on outside click: an alert dialog
 * must be answered by one of its two buttons. Radix supplies the focus trap and returns focus to
 * the trigger; those defaults are intentionally untouched.
 */

/**
 * `enter` / `exit` keyframes come from `tw-animate-css`, imported at the top of `theme.css`, and
 * are selected by the `data-state` Radix puts on the scrim and the surface.
 *
 * `motion-reduce:animate-none!` is important on purpose: `animate-in` and `animate-none` share a
 * utility namespace, so the `!` guarantees reduced motion wins regardless of Tailwind's ordering.
 * It also resolves `animation-name` to `none`, which tells Radix to unmount immediately instead
 * of waiting on an exit keyframe that will never run.
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

/** Pill button shared by Cancel and Action, matching the Figma Button `Large` footprint. */
const ACTION_BASE = [
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-sm rounded-full px-xl py-lg',
  'text-label-lg font-semibold transition-colors motion-reduce:transition-none',
  'disabled:pointer-events-none disabled:opacity-60',
];

export const ALERT_DIALOG_ACTION_VARIANTS = Object.freeze(['primary', 'destructive'] as const);
export type AlertDialogActionVariant = (typeof ALERT_DIALOG_ACTION_VARIANTS)[number];

export const alertDialogActionVariants = cva(ACTION_BASE, {
  variants: {
    variant: {
      /** Non-destructive confirmation, e.g. "Publish program". */
      primary: 'bg-primary text-primary-contrast hover:bg-primary-hover',
      /** Irreversible confirmation: "Discard draft", "Discard local draft". */
      destructive: 'bg-error text-background hover:bg-error/90',
    },
  },
  defaultVariants: {
    variant: 'primary',
  },
});

export const AlertDialog = AlertDialogPrimitive.Root;
export type AlertDialogProps = ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Root>;

export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export type AlertDialogTriggerProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Trigger
>;

export const AlertDialogPortal = AlertDialogPrimitive.Portal;
export type AlertDialogPortalProps = ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Portal>;

export type AlertDialogOverlayProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Overlay
>;

export const AlertDialogOverlay = forwardRef<
  ComponentRef<typeof AlertDialogPrimitive.Overlay>,
  AlertDialogOverlayProps
>(function AlertDialogOverlay({ className, ...overlayProps }, ref) {
  return (
    <AlertDialogPrimitive.Overlay
      {...overlayProps}
      ref={ref}
      className={cn('fixed inset-0 z-50 bg-black/60', OVERLAY_MOTION, className)}
    />
  );
});

export interface AlertDialogContentProps
  extends ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> {
  /** Classes for the scrim, which is rendered by this component. */
  overlayClassName?: string;
}

export const AlertDialogContent = forwardRef<
  ComponentRef<typeof AlertDialogPrimitive.Content>,
  AlertDialogContentProps
>(function AlertDialogContent({ className, overlayClassName, ...contentProps }, ref) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay className={overlayClassName} />
      <AlertDialogPrimitive.Content
        {...contentProps}
        ref={ref}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2',
          'flex w-[calc(100%-2rem)] max-w-[32.5rem] max-h-[calc(100svh-2rem)] flex-col gap-lg overflow-y-auto',
          'rounded-lg border border-border bg-surface-raised p-xl text-text shadow-overlay',
          SURFACE_MOTION,
          className,
        )}
      />
    </AlertDialogPortal>
  );
});

export type AlertDialogHeaderProps = HTMLAttributes<HTMLDivElement>;

export const AlertDialogHeader = forwardRef<HTMLDivElement, AlertDialogHeaderProps>(
  function AlertDialogHeader({ className, ...headerProps }, ref) {
    return (
      <div {...headerProps} ref={ref} className={cn('flex flex-col gap-sm text-left', className)} />
    );
  },
);

export type AlertDialogTitleProps = ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>;

export const AlertDialogTitle = forwardRef<
  ComponentRef<typeof AlertDialogPrimitive.Title>,
  AlertDialogTitleProps
>(function AlertDialogTitle({ className, ...titleProps }, ref) {
  return (
    <AlertDialogPrimitive.Title
      {...titleProps}
      ref={ref}
      className={cn('text-h2 text-text', className)}
    />
  );
});

export type AlertDialogDescriptionProps = ComponentPropsWithoutRef<
  typeof AlertDialogPrimitive.Description
>;

export const AlertDialogDescription = forwardRef<
  ComponentRef<typeof AlertDialogPrimitive.Description>,
  AlertDialogDescriptionProps
>(function AlertDialogDescription({ className, ...descriptionProps }, ref) {
  return (
    <AlertDialogPrimitive.Description
      {...descriptionProps}
      ref={ref}
      className={cn('text-body-sm text-text-muted', className)}
    />
  );
});

export type AlertDialogWarningProps = HTMLAttributes<HTMLDivElement>;

/**
 * The red-bordered consequence panel from `101:568`. Always fill it with words — the red border
 * is a reinforcement of the copy, never the only signal that the action is irreversible.
 */
export const AlertDialogWarning = forwardRef<HTMLDivElement, AlertDialogWarningProps>(
  function AlertDialogWarning({ className, ...warningProps }, ref) {
    return (
      <div
        {...warningProps}
        ref={ref}
        className={cn(
          'flex flex-col gap-xs rounded-md border border-error bg-surface-raised p-md',
          className,
        )}
      />
    );
  },
);

export type AlertDialogFooterProps = HTMLAttributes<HTMLDivElement>;

export const AlertDialogFooter = forwardRef<HTMLDivElement, AlertDialogFooterProps>(
  function AlertDialogFooter({ className, ...footerProps }, ref) {
    return (
      <div
        {...footerProps}
        ref={ref}
        className={cn(
          'mt-auto flex flex-col-reverse gap-md pt-md sm:flex-row sm:items-center sm:justify-end',
          className,
        )}
      />
    );
  },
);

export type AlertDialogCancelProps = ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>;

export const AlertDialogCancel = forwardRef<
  ComponentRef<typeof AlertDialogPrimitive.Cancel>,
  AlertDialogCancelProps
>(function AlertDialogCancel({ className, ...cancelProps }, ref) {
  return (
    <AlertDialogPrimitive.Cancel
      {...cancelProps}
      ref={ref}
      className={cn(
        ACTION_BASE,
        'border border-border bg-surface-raised text-text hover:border-border-brand',
        className,
      )}
    />
  );
});

export interface AlertDialogActionProps
  extends ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>,
    VariantProps<typeof alertDialogActionVariants> {}

export const AlertDialogAction = forwardRef<
  ComponentRef<typeof AlertDialogPrimitive.Action>,
  AlertDialogActionProps
>(function AlertDialogAction({ className, variant, ...actionProps }, ref) {
  return (
    <AlertDialogPrimitive.Action
      {...actionProps}
      ref={ref}
      className={cn(alertDialogActionVariants({ variant }), className)}
    />
  );
});
