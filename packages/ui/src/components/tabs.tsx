'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { CircleAlert } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ComponentRef } from 'react';

import { cn } from './class-names.js';

/*
 * Figma — "Tabs" (node 44:19).
 *
 * Underline style: 14px medium label over a 2px fully-rounded indicator inset to the trigger's
 * 16px horizontal padding.
 *   Default   text-muted, transparent indicator
 *   Hover     ambient wash, text
 *   Active    text, primary indicator
 *   Focus     2px violet ring
 *   Disabled  text-disabled, no indicator
 *
 * The trigger also carries an optional error marker. Create Program needs it: an asset-type tab
 * whose impact list fails validation must say so from the tab strip, because the failing field
 * lives in a panel the user cannot see — docs/flow/create-program-owner-flow-for-figma.md,
 * CP-02IV: "Tab có lỗi hiển thị error indicator ngoài label để lỗi không bị ẩn."
 */

export type TabsProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;

export const Tabs = forwardRef<ComponentRef<typeof TabsPrimitive.Root>, TabsProps>(function Tabs(
  { className, ...tabsProps },
  ref,
) {
  return <TabsPrimitive.Root {...tabsProps} ref={ref} className={cn('flex flex-col', className)} />;
});

export type TabsListProps = ComponentPropsWithoutRef<typeof TabsPrimitive.List>;

export const TabsList = forwardRef<ComponentRef<typeof TabsPrimitive.List>, TabsListProps>(
  function TabsList({ className, ...listProps }, ref) {
    return (
      <TabsPrimitive.List
        {...listProps}
        ref={ref}
        className={cn('flex w-full items-stretch border-b border-border', className)}
      />
    );
  },
);

export interface TabsTriggerProps
  extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  /** Marks the panel behind this tab as failing validation. */
  error?: boolean;
  /**
   * Screen-reader text for the marker. The icon and the red are the visual signal; this is the
   * non-colour half of it, so keep it meaningful.
   */
  errorLabel?: string;
}

export const TabsTrigger = forwardRef<
  ComponentRef<typeof TabsPrimitive.Trigger>,
  TabsTriggerProps
>(function TabsTrigger(
  { children, className, error = false, errorLabel = 'has validation errors', ...triggerProps },
  ref,
) {
  return (
    <TabsPrimitive.Trigger
      {...triggerProps}
      ref={ref}
      data-error={error ? 'true' : undefined}
      className={cn(
        'relative inline-flex min-h-11 items-center justify-center gap-sm whitespace-nowrap',
        'px-lg py-md text-label-lg text-text-muted transition-colors',
        // 2px indicator, inset to the horizontal padding, sitting on top of the list's hairline.
        "after:absolute after:inset-x-lg after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent after:content-['']",
        'hover:bg-ambient hover:text-text',
        'data-[state=active]:text-text data-[state=active]:after:bg-primary',
        'focus-visible:ring-2 focus-visible:ring-focus',
        'disabled:pointer-events-none disabled:text-text-disabled',
        'motion-reduce:transition-none',
        className,
      )}
    >
      <span>{children}</span>
      {error ? (
        // Outside the label, so a long label can never truncate the marker away.
        <span className="inline-flex shrink-0 items-center text-error">
          <CircleAlert aria-hidden="true" className="size-4" />
          <span className="sr-only">{errorLabel}</span>
        </span>
      ) : null}
    </TabsPrimitive.Trigger>
  );
});

export type TabsContentProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;

export const TabsContent = forwardRef<
  ComponentRef<typeof TabsPrimitive.Content>,
  TabsContentProps
>(function TabsContent({ className, ...contentProps }, ref) {
  return <TabsPrimitive.Content {...contentProps} ref={ref} className={cn('mt-xl', className)} />;
});
