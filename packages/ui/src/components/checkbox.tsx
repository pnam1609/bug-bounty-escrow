'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as LabelPrimitive from '@radix-ui/react-label';
import { Check, CircleAlert, Minus } from 'lucide-react';
import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from 'react';

import { cn } from './class-names.js';

/*
 * Figma — "Selection Control" (node 38:83), Type=Checkbox.
 *
 * 20px box, 6px radius (`rounded-sm`).
 *   Default            surface fill, 1px border
 *   Focus              2px violet ring (04 · Variants & States: "Focus dùng 2px violet ring")
 *   Selected           primary fill + white check
 *   Selected/Disabled  surface-raised fill, check stays legible
 * The disabled label drops to `text-text-disabled` rather than disappearing, per the same rule
 * ("Disabled giảm contrast nhưng vẫn đọc được").
 */

const CHECKBOX_CONTROL = [
  'peer relative inline-flex size-5 shrink-0 items-center justify-center',
  'rounded-sm border border-border bg-surface text-primary-contrast transition-colors',
  // The drawn control is 20px. This pseudo-element grows the pointer target to 44x44 without
  // touching layout, so even a bare Checkbox meets the 44px minimum in CONVENTIONS.md.
  "before:absolute before:-inset-3 before:content-['']",
  'hover:border-border-brand',
  'data-[state=checked]:bg-primary data-[state=indeterminate]:bg-primary',
  // Global :focus-visible already draws the outline; this adds the Figma 2px ring on top of it.
  'focus-visible:ring-2 focus-visible:ring-focus',
  'disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-raised',
  'disabled:hover:border-border',
  'disabled:data-[state=checked]:bg-surface-raised disabled:data-[state=indeterminate]:bg-surface-raised',
  'motion-reduce:transition-none',
].join(' ');

export type CheckboxProps = ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

export const Checkbox = forwardRef<ComponentRef<typeof CheckboxPrimitive.Root>, CheckboxProps>(
  function Checkbox({ className, ...checkboxProps }, ref) {
    return (
      <CheckboxPrimitive.Root
        {...checkboxProps}
        ref={ref}
        className={cn(CHECKBOX_CONTROL, className)}
      >
        {/* Radix stamps data-state on the indicator, so the glyph swap works for controlled and
            uncontrolled checkboxes alike. */}
        <CheckboxPrimitive.Indicator className="group/state flex items-center justify-center text-current">
          <Check
            aria-hidden="true"
            className="size-3.5 group-data-[state=indeterminate]/state:hidden"
            strokeWidth={3}
          />
          <Minus
            aria-hidden="true"
            className="hidden size-3.5 group-data-[state=indeterminate]/state:block"
            strokeWidth={3}
          />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
  },
);

export interface CheckboxFieldProps extends Omit<CheckboxProps, 'children' | 'className'> {
  /** Class for the field wrapper. Use `controlClassName` to reach the box itself. */
  className?: string;
  controlClassName?: string;
  /** Helper copy under the control; linked with `aria-describedby`. */
  description?: ReactNode;
  /** Validation message; linked with `aria-describedby` and announced. */
  error?: ReactNode;
  label: ReactNode;
}

/**
 * Checkbox with its label — the form the product actually uses. The label cell is `min-h-11`
 * and spans the rest of the row, so the pointer target clears 44x44 in both directions.
 */
export const CheckboxField = forwardRef<
  ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxFieldProps
>(function CheckboxField(
  { className, controlClassName, description, disabled, error, id, label, ...checkboxProps },
  ref,
) {
  const generatedId = useId();
  const controlId = id ?? `${generatedId}-checkbox`;
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
        <Checkbox
          {...checkboxProps}
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
            <p
              id={errorId}
              role="alert"
              className="flex items-start gap-xs text-body-sm text-error"
            >
              <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
