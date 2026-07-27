'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { CircleAlert } from 'lucide-react';
import {
  forwardRef,
  useId,
  type ComponentPropsWithoutRef,
  type ComponentRef,
  type ReactNode,
} from 'react';

import { cn } from './class-names.js';

/*
 * Figma — "Selection Control" (node 38:83), Type=Switch.
 *
 * 40x22 track, fully rounded, 18px thumb with a 2px inset — so the thumb travels 18px.
 *   Default            surface-raised track, white thumb
 *   Focus              2px violet ring
 *   Selected           primary track, white thumb at the far end
 *   Disabled           track loses its violet (ambient when on, surface-raised when off) and the
 *                      thumb drops to the disabled text tone, so "off" and "on" stay
 *                      distinguishable without relying on the brand colour.
 *
 * Unlike the checkbox and radio the Figma switch track carries no border — the focus ring is the
 * only stroke it ever gets.
 */

const SWITCH_TRACK = [
  'group relative inline-flex h-5.5 w-10 shrink-0 cursor-pointer items-center',
  'rounded-full bg-surface-raised p-0.5 transition-colors',
  // Grows the pointer target past 44x44 without touching layout (CONVENTIONS.md, 44px minimum).
  "before:absolute before:-inset-3 before:content-['']",
  'data-[state=checked]:bg-primary',
  'focus-visible:ring-2 focus-visible:ring-focus',
  'disabled:cursor-not-allowed disabled:bg-surface-raised',
  'disabled:data-[state=checked]:bg-ambient',
  'motion-reduce:transition-none',
].join(' ');

const SWITCH_THUMB = [
  'pointer-events-none block size-4.5 rounded-full bg-primary-contrast shadow-subtle',
  'transition-transform data-[state=checked]:translate-x-4.5',
  'group-disabled:bg-text-disabled',
  'motion-reduce:transition-none',
].join(' ');

export type SwitchProps = ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export const Switch = forwardRef<ComponentRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, ...switchProps }, ref) {
    return (
      <SwitchPrimitive.Root {...switchProps} ref={ref} className={cn(SWITCH_TRACK, className)}>
        <SwitchPrimitive.Thumb className={SWITCH_THUMB} />
      </SwitchPrimitive.Root>
    );
  },
);

export interface SwitchFieldProps extends Omit<SwitchProps, 'children' | 'className'> {
  /** Class for the field wrapper. Use `controlClassName` to reach the track itself. */
  className?: string;
  controlClassName?: string;
  /** Helper copy under the control; linked with `aria-describedby`. */
  description?: ReactNode;
  /** Validation message; linked with `aria-describedby` and announced. */
  error?: ReactNode;
  label: ReactNode;
}

/**
 * Switch with its label, laid out control-then-label the way node 38:83 draws it. The label cell
 * is `min-h-11` and spans the rest of the row, so the pointer target clears 44x44.
 */
export const SwitchField = forwardRef<ComponentRef<typeof SwitchPrimitive.Root>, SwitchFieldProps>(
  function SwitchField(
    { className, controlClassName, description, disabled, error, id, label, ...switchProps },
    ref,
  ) {
    const generatedId = useId();
    const controlId = id ?? `${generatedId}-switch`;
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
          <Switch
            {...switchProps}
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
  },
);
