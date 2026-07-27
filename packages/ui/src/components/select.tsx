'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from './class-names.js';

export const SELECT_SIZES = Object.freeze(['md', 'lg'] as const);
export type SelectSize = (typeof SELECT_SIZES)[number];

export const Select = SelectPrimitive.Root;
export type SelectProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Root>;

export const SelectGroup = SelectPrimitive.Group;
export type SelectGroupProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Group>;

export const SelectValue = SelectPrimitive.Value;
export type SelectValueProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Value>;

/**
 * Figma `04 · Variants & States → Select` (node 43:49) draws the closed trigger exactly like a
 * medium Input — same 40px height, radius, surface and five states — with a chevron in muted text
 * on the trailing edge. The `lg` size mirrors the large Input.
 */
export const selectTriggerVariants = cva(
  [
    'flex w-full items-center justify-between gap-sm rounded-md border border-input-border',
    'bg-input text-start text-body-sm',
    'transition-colors motion-reduce:transition-none',
    'hover:border-border-brand',
    'data-[placeholder]:text-input-placeholder',
    'focus-visible:border-input-border-focus focus-visible:ring-1 focus-visible:ring-input-border-focus focus-visible:ring-inset',
    'data-[state=open]:border-input-border-focus',
    'aria-[invalid=true]:border-error aria-[invalid=true]:hover:border-error',
    'disabled:cursor-not-allowed disabled:border-input-border disabled:bg-surface-raised',
    'disabled:text-text-disabled disabled:hover:border-input-border',
    '[&>span]:line-clamp-1 [&>span]:text-start',
  ],
  {
    variants: {
      size: {
        md: 'h-10 px-md',
        lg: 'h-12 px-lg',
      } satisfies Record<SelectSize, string>,
    },
    defaultVariants: { size: 'md' },
  },
);

export interface SelectTriggerProps
  extends ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>,
    VariantProps<typeof selectTriggerVariants> {
  size?: SelectSize | undefined;
}

export const SelectTrigger = forwardRef<
  ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(function SelectTrigger({ children, className, size = 'md', ...triggerProps }, ref) {
  return (
    <SelectPrimitive.Trigger
      {...triggerProps}
      ref={ref}
      className={cn(selectTriggerVariants({ size }), className)}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 text-text-muted transition-transform"
        />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

export type SelectScrollUpButtonProps = ComponentPropsWithoutRef<
  typeof SelectPrimitive.ScrollUpButton
>;

export const SelectScrollUpButton = forwardRef<
  ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
  SelectScrollUpButtonProps
>(function SelectScrollUpButton({ className, ...buttonProps }, ref) {
  return (
    <SelectPrimitive.ScrollUpButton
      {...buttonProps}
      ref={ref}
      className={cn('flex cursor-default items-center justify-center py-xs', className)}
    >
      <ChevronUp aria-hidden="true" className="size-4 text-text-muted" />
    </SelectPrimitive.ScrollUpButton>
  );
});

export type SelectScrollDownButtonProps = ComponentPropsWithoutRef<
  typeof SelectPrimitive.ScrollDownButton
>;

export const SelectScrollDownButton = forwardRef<
  ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
  SelectScrollDownButtonProps
>(function SelectScrollDownButton({ className, ...buttonProps }, ref) {
  return (
    <SelectPrimitive.ScrollDownButton
      {...buttonProps}
      ref={ref}
      className={cn('flex cursor-default items-center justify-center py-xs', className)}
    >
      <ChevronDown aria-hidden="true" className="size-4 text-text-muted" />
    </SelectPrimitive.ScrollDownButton>
  );
});

export type SelectContentProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Content>;

export const SelectContent = forwardRef<
  ComponentRef<typeof SelectPrimitive.Content>,
  SelectContentProps
>(function SelectContent(
  { children, className, position = 'popper', sideOffset = 4, ...contentProps },
  ref,
) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        {...contentProps}
        ref={ref}
        className={cn(
          'relative z-50 max-h-96 min-w-32 overflow-hidden rounded-md border border-border',
          'bg-surface-raised text-body-sm shadow-overlay',
          className,
        )}
        position={position}
        sideOffset={sideOffset}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn('p-xs', position === 'popper' && 'w-full min-w-(--radix-select-trigger-width)')}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export type SelectLabelProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Label>;

export const SelectLabel = forwardRef<
  ComponentRef<typeof SelectPrimitive.Label>,
  SelectLabelProps
>(function SelectLabel({ className, ...labelProps }, ref) {
  return (
    <SelectPrimitive.Label
      {...labelProps}
      ref={ref}
      // Arbitrary property rather than `text-text-muted`, which would share a tailwind-merge
      // group with `text-label-md` and drop the font size.
      className={cn('px-sm py-xs text-label-md [color:var(--color-text-muted)]', className)}
    />
  );
});

export type SelectItemProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Item>;

export const SelectItem = forwardRef<ComponentRef<typeof SelectPrimitive.Item>, SelectItemProps>(
  function SelectItem({ children, className, ...itemProps }, ref) {
    return (
      <SelectPrimitive.Item
        {...itemProps}
        ref={ref}
        className={cn(
          'relative flex w-full cursor-default items-center rounded-sm py-xs pe-xl ps-sm select-none',
          'data-highlighted:bg-ambient focus:bg-ambient',
          'data-[disabled]:pointer-events-none data-[disabled]:text-text-disabled',
          className,
        )}
      >
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        <span className="absolute end-sm flex size-4 items-center justify-center">
          <SelectPrimitive.ItemIndicator>
            <Check aria-hidden="true" className="size-4 text-primary" />
          </SelectPrimitive.ItemIndicator>
        </span>
      </SelectPrimitive.Item>
    );
  },
);

export type SelectSeparatorProps = ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>;

export const SelectSeparator = forwardRef<
  ComponentRef<typeof SelectPrimitive.Separator>,
  SelectSeparatorProps
>(function SelectSeparator({ className, ...separatorProps }, ref) {
  return (
    <SelectPrimitive.Separator
      {...separatorProps}
      ref={ref}
      className={cn('-mx-xs my-xs h-px bg-border', className)}
    />
  );
});
