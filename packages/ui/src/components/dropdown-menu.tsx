'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowRight, Check } from 'lucide-react';
import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type HTMLAttributes,
} from 'react';

import { cn } from './class-names.js';

/**
 * Dropdown menu — the researcher / owner account menu (`RS-NAV-01 · Account menu open`), i.e. the
 * avatar trigger in the app-shell header with `Logout` at the foot of it.
 *
 * The surface follows the open-select menu in Figma `187:1194`: surface/raised on a 1px border,
 * radius/md, 4px of inset padding, and rows on `--bbe-nav-item-bg-active` (= ambient) when
 * highlighted with a mint check for the selected option.
 *
 * `Escape` closes the menu and focus returns to the trigger. Both come free from Radix — do not
 * intercept `onEscapeKeyDown` or `onCloseAutoFocus`. The global `:focus-visible` outline is also
 * left in place on items, so the highlight is never the only indication of keyboard position.
 */

/**
 * `enter` / `exit` keyframes come from `tw-animate-css`, imported at the top of `theme.css`. The
 * menu grows out of the corner nearest its trigger, so an account menu anchored to a header
 * avatar unfolds downward from that avatar.
 *
 * `motion-reduce:animate-none!` is important on purpose: `animate-in` and `animate-none` share a
 * utility namespace, so the `!` guarantees reduced motion wins regardless of Tailwind's ordering.
 * It also resolves `animation-name` to `none`, which tells Radix to unmount immediately instead
 * of waiting on an exit keyframe that will never run.
 */
const SURFACE_MOTION = [
  'origin-[var(--radix-dropdown-menu-content-transform-origin)] duration-150',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
  'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
  'data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2',
  'motion-reduce:animate-none!',
];

const SURFACE_BASE = [
  'z-50 min-w-[12rem] max-w-[calc(100vw-2rem)]',
  'rounded-md border border-border bg-surface-raised p-xs text-text shadow-elevated',
  'max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto',
];

export const DROPDOWN_MENU_ITEM_VARIANTS = Object.freeze(['default', 'destructive'] as const);
export type DropdownMenuItemVariant = (typeof DROPDOWN_MENU_ITEM_VARIANTS)[number];

export const dropdownMenuItemVariants = cva(
  [
    // 44px minimum target, matching the app-wide interactive floor.
    'relative flex min-h-11 w-full cursor-pointer select-none items-center gap-sm',
    'rounded-sm px-md py-sm text-body-sm',
    'transition-colors motion-reduce:transition-none',
    'data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled',
  ],
  {
    variants: {
      variant: {
        default: 'text-text-muted data-[highlighted]:bg-ambient data-[highlighted]:text-text',
        /** "Delete program", "Revoke key" — red is destructive only. */
        destructive: 'text-error data-[highlighted]:bg-error/10 data-[highlighted]:text-error',
      },
      inset: {
        true: 'pl-2xl',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      inset: false,
    },
  },
);

export const DropdownMenu = DropdownMenuPrimitive.Root;
export type DropdownMenuProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>;

export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export type DropdownMenuTriggerProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Trigger
>;

export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export type DropdownMenuPortalProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Portal
>;

export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export type DropdownMenuGroupProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Group>;

export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export type DropdownMenuRadioGroupProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.RadioGroup
>;

export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export type DropdownMenuSubProps = ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Sub>;

export type DropdownMenuContentProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Content
>;

export const DropdownMenuContent = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(function DropdownMenuContent(
  { align = 'end', className, collisionPadding = 8, sideOffset = 8, ...contentProps },
  ref,
) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        {...contentProps}
        ref={ref}
        align={align}
        collisionPadding={collisionPadding}
        sideOffset={sideOffset}
        className={cn(SURFACE_BASE, SURFACE_MOTION, className)}
      />
    </DropdownMenuPrimitive.Portal>
  );
});

export type DropdownMenuSubContentProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.SubContent
>;

export const DropdownMenuSubContent = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.SubContent>,
  DropdownMenuSubContentProps
>(function DropdownMenuSubContent({ className, collisionPadding = 8, ...subContentProps }, ref) {
  return (
    <DropdownMenuPrimitive.SubContent
      {...subContentProps}
      ref={ref}
      collisionPadding={collisionPadding}
      className={cn(SURFACE_BASE, SURFACE_MOTION, className)}
    />
  );
});

export interface DropdownMenuItemProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>,
    VariantProps<typeof dropdownMenuItemVariants> {}

export const DropdownMenuItem = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Item>,
  DropdownMenuItemProps
>(function DropdownMenuItem({ className, inset, variant, ...itemProps }, ref) {
  return (
    <DropdownMenuPrimitive.Item
      {...itemProps}
      ref={ref}
      className={cn(dropdownMenuItemVariants({ inset, variant }), className)}
    />
  );
});

export interface DropdownMenuSubTriggerProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> {
  /** Align the label with sibling items that reserve room for a check. */
  inset?: boolean;
}

export const DropdownMenuSubTrigger = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.SubTrigger>,
  DropdownMenuSubTriggerProps
>(function DropdownMenuSubTrigger({ children, className, inset = false, ...subTriggerProps }, ref) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      {...subTriggerProps}
      ref={ref}
      className={cn(
        dropdownMenuItemVariants({ inset }),
        'data-[state=open]:bg-ambient data-[state=open]:text-text',
        className,
      )}
    >
      {children}
      <ArrowRight aria-hidden="true" className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
});

export type DropdownMenuCheckboxItemProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.CheckboxItem
>;

export const DropdownMenuCheckboxItem = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  DropdownMenuCheckboxItemProps
>(function DropdownMenuCheckboxItem({ children, className, ...checkboxItemProps }, ref) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      {...checkboxItemProps}
      ref={ref}
      className={cn(dropdownMenuItemVariants({ inset: true }), className)}
    >
      <DropdownMenuPrimitive.ItemIndicator className="absolute left-md inline-flex size-4 items-center justify-center">
        {/* aria-checked already announces the state; the glyph is the visual half of it. */}
        <Check aria-hidden="true" className="size-4 text-escrow" />
      </DropdownMenuPrimitive.ItemIndicator>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
});

export type DropdownMenuRadioItemProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.RadioItem
>;

export const DropdownMenuRadioItem = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.RadioItem>,
  DropdownMenuRadioItemProps
>(function DropdownMenuRadioItem({ children, className, ...radioItemProps }, ref) {
  return (
    <DropdownMenuPrimitive.RadioItem
      {...radioItemProps}
      ref={ref}
      className={cn(dropdownMenuItemVariants({ inset: true }), className)}
    >
      <DropdownMenuPrimitive.ItemIndicator className="absolute left-md inline-flex size-4 items-center justify-center">
        <Check aria-hidden="true" className="size-4 text-escrow" />
      </DropdownMenuPrimitive.ItemIndicator>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
});

export interface DropdownMenuLabelProps
  extends ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> {
  /** Align the label with items that reserve room for a check. */
  inset?: boolean;
}

export const DropdownMenuLabel = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Label>,
  DropdownMenuLabelProps
>(function DropdownMenuLabel({ className, inset = false, ...labelProps }, ref) {
  return (
    <DropdownMenuPrimitive.Label
      {...labelProps}
      ref={ref}
      className={cn(
        'px-md py-sm text-label-md text-text-muted',
        inset ? 'pl-2xl' : undefined,
        className,
      )}
    />
  );
});

export type DropdownMenuSeparatorProps = ComponentPropsWithoutRef<
  typeof DropdownMenuPrimitive.Separator
>;

export const DropdownMenuSeparator = forwardRef<
  ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  DropdownMenuSeparatorProps
>(function DropdownMenuSeparator({ className, ...separatorProps }, ref) {
  return (
    <DropdownMenuPrimitive.Separator
      {...separatorProps}
      ref={ref}
      className={cn('-mx-xs my-xs h-px bg-border', className)}
    />
  );
});

export type DropdownMenuShortcutProps = HTMLAttributes<HTMLSpanElement>;

export const DropdownMenuShortcut = forwardRef<HTMLSpanElement, DropdownMenuShortcutProps>(
  function DropdownMenuShortcut({ className, ...shortcutProps }, ref) {
    return (
      <span
        {...shortcutProps}
        ref={ref}
        className={cn('ml-auto text-label-sm text-text-disabled', className)}
      />
    );
  },
);
