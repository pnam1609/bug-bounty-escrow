'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { Check, CircleAlert } from 'lucide-react';
import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from 'react';

import { cn } from './class-names.js';

/*
 * Figma — "Selection Control" (node 38:83), Type=Radio.
 *
 * 20px circle, 10px inner dot.
 *   Default            surface fill, 1px border
 *   Focus              2px violet ring
 *   Selected           violet ring + violet dot
 *   Disabled           surface-raised fill, dot drops to the disabled text tone
 *
 * The card variant below is the onboarding account-type picker and the submit-bug severity
 * picker. Both flows require the selected state to differ by border AND background AND a check
 * icon — see docs/flow/onboarding-role-flow-for-figma.md §6.4: "Selected state có border,
 * background và check icon; không chỉ khác màu."
 */

export type RadioGroupProps = ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>;

export const RadioGroup = forwardRef<ComponentRef<typeof RadioGroupPrimitive.Root>, RadioGroupProps>(
  function RadioGroup({ className, ...groupProps }, ref) {
    return (
      <RadioGroupPrimitive.Root
        {...groupProps}
        ref={ref}
        className={cn('grid gap-sm', className)}
      />
    );
  },
);

const RADIO_CONTROL = [
  'group peer relative inline-flex size-5 shrink-0 items-center justify-center',
  'rounded-full border border-border bg-surface transition-colors',
  // Grows the pointer target to 44x44 without touching layout (CONVENTIONS.md, 44px minimum).
  "before:absolute before:-inset-3 before:content-['']",
  'hover:border-border-brand',
  'data-[state=checked]:border-primary',
  'focus-visible:ring-2 focus-visible:ring-focus',
  'disabled:cursor-not-allowed disabled:bg-surface-raised disabled:hover:border-border',
  'motion-reduce:transition-none',
].join(' ');

export type RadioGroupItemProps = ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>;

export const RadioGroupItem = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemProps
>(function RadioGroupItem({ className, ...itemProps }, ref) {
  return (
    <RadioGroupPrimitive.Item {...itemProps} ref={ref} className={cn(RADIO_CONTROL, className)}>
      <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
        <span
          aria-hidden="true"
          className="size-2.5 rounded-full bg-primary group-disabled:bg-text-disabled"
        />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});

export interface RadioGroupItemFieldProps extends Omit<RadioGroupItemProps, 'children' | 'className'> {
  /** Class for the field wrapper. Use `controlClassName` to reach the circle itself. */
  className?: string;
  controlClassName?: string;
  /** Helper copy under the control; linked with `aria-describedby`. */
  description?: ReactNode;
  /** Validation message; linked with `aria-describedby` and announced. */
  error?: ReactNode;
  label: ReactNode;
}

/**
 * Radio with its label. The label cell is `min-h-11` and spans the rest of the row, so the
 * pointer target clears 44x44 in both directions.
 */
export const RadioGroupItemField = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupItemFieldProps
>(function RadioGroupItemField(
  { className, controlClassName, description, disabled, error, id, label, ...itemProps },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? `${generatedId}-radio`;
  const descriptionId = `${controlId}-description`;
  const errorId = `${controlId}-error`;

  const describedByIds: string[] = [];
  if (description) {
    describedByIds.push(descriptionId);
  }
  if (error) {
    describedByIds.push(errorId);
  }
  const describedBy = describedByIds.length > 0 ? describedByIds.join(' ') : undefined;

  return (
    <div className={cn('grid grid-cols-[auto_1fr] gap-x-sm', className)}>
      <span className="flex min-h-11 items-center">
        <RadioGroupItem
          {...itemProps}
          ref={ref}
          id={controlId}
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={controlClassName}
        />
      </span>
      <LabelPrimitive.Root
        htmlFor={controlId}
        className={cn(
          'flex min-h-11 items-center text-body-sm',
          disabled ? 'cursor-not-allowed text-text-disabled' : 'cursor-pointer text-text',
        )}
      >
        {label}
      </LabelPrimitive.Root>
      {description || error ? (
        <div className="col-start-2 flex flex-col gap-sm pb-sm">
          {description ? (
            <p id={descriptionId} className="text-body-sm text-text-muted">
              {description}
            </p>
          ) : null}
          {error ? (
            <p id={errorId} role="alert" className="flex items-start gap-xs text-body-sm text-error">
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export interface RadioGroupCardProps
  extends Omit<RadioGroupItemProps, 'children' | 'title'> {
  /**
   * Extra content under the description — a severity dot, a price, a badge. Keep it to phrasing
   * content: the card root is a `<button>`.
   */
  children?: ReactNode;
  description?: ReactNode;
  /** Leading glyph, e.g. a Lucide icon. Decorative; the title carries the meaning. */
  icon?: ReactNode;
  title: ReactNode;
}

/**
 * Bordered selectable card — the onboarding account-type screen and the submit-bug severity
 * picker. The whole card is the radio, so arrow-key roving focus and Space/Enter come from
 * Radix for free. Selected differs by border, background and a check mark, never colour alone.
 */
export const RadioGroupCard = forwardRef<
  ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioGroupCardProps
>(function RadioGroupCard({ children, className, description, icon, title, ...itemProps }, ref) {
  return (
    <RadioGroupPrimitive.Item
      {...itemProps}
      ref={ref}
      className={cn(
        'group relative flex min-h-11 w-full items-start gap-md rounded-lg border border-border',
        'bg-surface p-lg text-left transition-colors',
        'hover:border-border-brand',
        'data-[state=checked]:border-border-brand data-[state=checked]:bg-ambient',
        'focus-visible:ring-2 focus-visible:ring-focus',
        'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-raised',
        'disabled:hover:border-border',
        'motion-reduce:transition-none',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-md',
            'bg-surface-raised text-text-muted transition-colors',
            'group-data-[state=checked]:bg-primary group-data-[state=checked]:text-primary-contrast',
            'motion-reduce:transition-none',
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-xs">
        <span className="text-label-lg text-text group-disabled:text-text-disabled">{title}</span>
        {description ? (
          <span className="text-body-sm text-text-muted group-disabled:text-text-disabled">
            {description}
          </span>
        ) : null}
        {children}
      </span>
      {/* Ring is always drawn so the card does not reflow on selection; the check only appears
          when selected, which is the third non-colour signal. */}
      <span
        aria-hidden="true"
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border border-border',
          'bg-surface transition-colors',
          'group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary',
          'motion-reduce:transition-none',
        )}
      >
        <RadioGroupPrimitive.Indicator className="flex items-center justify-center">
          <Check className="size-3 text-primary-contrast" strokeWidth={3} />
        </RadioGroupPrimitive.Indicator>
      </span>
    </RadioGroupPrimitive.Item>
  );
});
