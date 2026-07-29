'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Check, ChevronDown, CircleAlert } from 'lucide-react';
import {
  Children,
  cloneElement,
  createContext,
  forwardRef,
  isValidElement,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { cn } from './class-names.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './dropdown-menu.js';

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

interface TabsValueContextValue {
  selectedValue: string;
  selectValue: (value: string) => void;
}

const TabsValueContext = createContext<TabsValueContextValue | null>(null);

export type TabsProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;

export const Tabs = forwardRef<ComponentRef<typeof TabsPrimitive.Root>, TabsProps>(function Tabs(
  { className, defaultValue, onValueChange, value, ...tabsProps },
  ref,
) {
  /*
   * Keep an explicit value for uncontrolled roots as well. Overflow menu items are not Radix tab
   * triggers, so they need the same value setter as a regular trigger. Making the primitive
   * controlled in both modes keeps those two input paths identical.
   */
  const [internalValue, setInternalValue] = useState(defaultValue ?? '');
  const selectedValue = value ?? internalValue;
  const selectValue = useCallback(
    (nextValue: string) => {
      if (value === undefined) {
        setInternalValue(nextValue);
      }
      onValueChange?.(nextValue);
    },
    [onValueChange, value],
  );

  return (
    <TabsValueContext.Provider value={{ selectedValue, selectValue }}>
      <TabsPrimitive.Root
        {...tabsProps}
        ref={ref}
        className={cn('flex flex-col', className)}
        onValueChange={selectValue}
        value={selectedValue}
      />
    </TabsValueContext.Provider>
  );
});

export interface TabsListProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.List> {
  /** Accessible label for the mobile overflow menu trigger. */
  moreLabel?: string;
}

const DESKTOP_QUERY = '(min-width: 48rem)';

/**
 * Returns how many leading tabs fit beside the fixed-width More trigger.
 *
 * Exported to keep the responsive layout algorithm testable without a browser layout engine.
 */
export function calculateVisibleTabCount(
  availableWidth: number,
  tabWidths: readonly number[],
  moreWidth: number,
  desktop: boolean,
): number {
  if (desktop || tabWidths.reduce((total, width) => total + width, 0) <= availableWidth) {
    return tabWidths.length;
  }

  let usedWidth = moreWidth;
  let visibleCount = 0;

  for (const width of tabWidths) {
    if (usedWidth + width > availableWidth) {
      break;
    }
    usedWidth += width;
    visibleCount += 1;
  }

  // Retain one direct tab even at the narrowest supported viewport.
  return Math.min(tabWidths.length, Math.max(1, visibleCount));
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === 'function') {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

function isTabsTrigger(child: ReactNode): child is ReactElement<TabsTriggerProps> {
  return isValidElement<TabsTriggerProps>(child) && child.type === TabsTrigger;
}

function ErrorMarker({ errorLabel, visible = true }: { errorLabel: string; visible?: boolean }) {
  return (
    <span
      aria-hidden={visible ? undefined : 'true'}
      className={cn(
        'inline-flex shrink-0 items-center text-error',
        visible ? undefined : 'opacity-0',
      )}
    >
      <CircleAlert aria-hidden="true" className="size-4" />
      {visible ? <span className="sr-only">{errorLabel}</span> : null}
    </span>
  );
}

export const TabsList = forwardRef<ComponentRef<typeof TabsPrimitive.List>, TabsListProps>(
  function TabsList({ children, className, moreLabel = 'More', ...listProps }, ref) {
    const tabsContext = useContext(TabsValueContext);
    const containerRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<ComponentRef<typeof TabsPrimitive.List>>(null);
    const moreProbeRef = useRef<HTMLSpanElement>(null);
    const childArray = Children.toArray(children);
    const triggerChildren = childArray.filter(isTabsTrigger);
    const [visibleCount, setVisibleCount] = useState(triggerChildren.length);

    const measure = useCallback(() => {
      const container = containerRef.current;
      const list = listRef.current;
      const moreProbe = moreProbeRef.current;
      if (!container || !list || !moreProbe) {
        return;
      }

      const tabWidths = Array.from(
        list.querySelectorAll<HTMLElement>('[data-responsive-tab-trigger]'),
        (trigger) => trigger.getBoundingClientRect().width,
      );
      if (tabWidths.length !== triggerChildren.length || tabWidths.some((width) => width === 0)) {
        return;
      }

      setVisibleCount(
        calculateVisibleTabCount(
          container.clientWidth,
          tabWidths,
          moreProbe.getBoundingClientRect().width,
          window.matchMedia(DESKTOP_QUERY).matches,
        ),
      );
    }, [triggerChildren.length]);

    useLayoutEffect(() => {
      measure();
    }, [children, measure]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const mediaQuery = window.matchMedia(DESKTOP_QUERY);
      const observer = new ResizeObserver(measure);
      observer.observe(container);
      mediaQuery.addEventListener('change', measure);
      void document.fonts?.ready.then(measure);

      return () => {
        observer.disconnect();
        mediaQuery.removeEventListener('change', measure);
      };
    }, [measure]);

    const overflowTriggers = triggerChildren.slice(visibleCount);
    const activeOverflowTrigger = overflowTriggers.find(
      (trigger) => trigger.props.value === tabsContext?.selectedValue,
    );
    const hiddenError = overflowTriggers.some((trigger) => trigger.props.error);

    let triggerIndex = 0;
    const renderedChildren = childArray.map((child) => {
      if (!isTabsTrigger(child)) {
        return child;
      }

      const hidden = triggerIndex >= visibleCount;
      triggerIndex += 1;
      return cloneElement(child, {
        'aria-hidden': hidden ? true : child.props['aria-hidden'],
        className: cn(
          child.props.className,
          hidden ? 'pointer-events-none absolute left-0 top-0 invisible' : undefined,
        ),
        'data-responsive-tab-trigger': '',
        disabled: hidden || child.props.disabled,
        key: child.key,
      });
    });

    return (
      <div
        ref={containerRef}
        className={cn('relative flex w-full items-stretch border-b border-border', className)}
      >
        <TabsPrimitive.List
          {...listProps}
          ref={(node) => {
            listRef.current = node;
            assignRef(ref, node);
          }}
          className="flex min-w-0 flex-1 items-stretch"
        >
          {renderedChildren}
        </TabsPrimitive.List>

        {overflowTriggers.length > 0 && tabsContext ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={
                  activeOverflowTrigger
                    ? `${moreLabel} tabs; current tab: ${String(activeOverflowTrigger.props.children)}`
                    : `${moreLabel} tabs`
                }
                className={cn(
                  'relative inline-flex min-h-11 shrink-0 items-center justify-center gap-sm',
                  'px-lg py-md text-label-lg text-text-muted transition-colors',
                  "after:absolute after:inset-x-lg after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent after:content-['']",
                  'hover:bg-ambient hover:text-text',
                  'focus-visible:ring-2 focus-visible:ring-focus',
                  'motion-reduce:transition-none',
                  activeOverflowTrigger ? 'text-text after:bg-primary' : undefined,
                )}
              >
                <span>{moreLabel}</span>
                {activeOverflowTrigger ? <Check aria-hidden="true" className="size-4" /> : null}
                {hiddenError ? <ErrorMarker errorLabel="Hidden tab has validation errors" /> : null}
                <ChevronDown aria-hidden="true" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                onValueChange={tabsContext.selectValue}
                value={tabsContext.selectedValue}
              >
                {overflowTriggers.map((trigger) => (
                  <DropdownMenuRadioItem
                    {...(trigger.props.disabled ? { disabled: true } : {})}
                    key={trigger.props.value}
                    value={trigger.props.value}
                  >
                    <span>{trigger.props.children}</span>
                    {trigger.props.error ? (
                      <ErrorMarker
                        errorLabel={trigger.props.errorLabel ?? 'has validation errors'}
                      />
                    ) : null}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        <span
          ref={moreProbeRef}
          aria-hidden="true"
          className="pointer-events-none absolute left-0 top-0 inline-flex min-h-11 items-center gap-sm px-lg py-md text-label-lg invisible"
        >
          <span>{moreLabel}</span>
          <Check aria-hidden="true" className="size-4" />
          <ErrorMarker errorLabel="" visible={false} />
          <ChevronDown aria-hidden="true" className="size-4" />
        </span>
      </div>
    );
  },
);

export interface TabsTriggerProps extends ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> {
  /** Internal measurement marker used by the responsive tab list. */
  'data-responsive-tab-trigger'?: string;
  /** Marks the panel behind this tab as failing validation. */
  error?: boolean;
  /**
   * Screen-reader text for the marker. The icon and the red are the visual signal; this is the
   * non-colour half of it, so keep it meaningful.
   */
  errorLabel?: string;
}

export const TabsTrigger = forwardRef<ComponentRef<typeof TabsPrimitive.Trigger>, TabsTriggerProps>(
  function TabsTrigger(
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
        {/* Outside the label, so a long label can never truncate the marker away. */}
        {error ? <ErrorMarker errorLabel={errorLabel} /> : null}
      </TabsPrimitive.Trigger>
    );
  },
);

export type TabsContentProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Content>;

export const TabsContent = forwardRef<ComponentRef<typeof TabsPrimitive.Content>, TabsContentProps>(
  function TabsContent({ className, ...contentProps }, ref) {
    return <TabsPrimitive.Content {...contentProps} ref={ref} className={cn('mt-xl', className)} />;
  },
);
