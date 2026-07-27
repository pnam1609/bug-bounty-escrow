'use client';

import { CircleAlert } from 'lucide-react';
import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type AriaAttributes,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from 'react';

import { cn } from './class-names.js';
import { Label } from './label.js';

/** The aria wiring `Field` injects into whichever control it wraps. */
interface FieldControlProps {
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
  id?: string | undefined;
}

export interface FieldProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** The control: an `Input`, `Textarea`, `SelectTrigger`, … */
  children: ReactNode;
  /**
   * Character counter, e.g. `140/280`. Rendered beside the message, never in place of it — an
   * errored field shows both.
   */
  counter?: ReactNode;
  /** Dims the label. Set it alongside `disabled` on the control itself. */
  disabled?: boolean | undefined;
  /** When present the field renders as invalid and this replaces `helperText` as the message. */
  error?: ReactNode;
  helperText?: ReactNode;
  /** Id of the control. Defaults to a generated id that is injected into `children`. */
  htmlFor?: string | undefined;
  label?: ReactNode;
  required?: boolean | undefined;
}

function isPresent(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false && node !== '';
}

/**
 * The form field anatomy from Figma node 186:116 and the spacing contract documented on the Input
 * component: label → control 8px, control → helper/error/counter 8px, and helper, counter and
 * error all stay inside one field group. The 32px gap to the *next* field belongs to the form
 * layout, not to this component.
 *
 * `Field` owns the aria plumbing: it gives the control an id, points `aria-describedby` at the
 * message and counter it rendered, and sets `aria-invalid` when there is an error — so the error
 * styling in `Input` / `Textarea` / `SelectTrigger` lights up without a second boolean prop.
 */
export const Field = forwardRef<HTMLDivElement, FieldProps>(function Field(
  {
    children,
    className,
    counter,
    disabled = false,
    error,
    helperText,
    htmlFor,
    label,
    required = false,
    ...fieldProps
  },
  ref,
) {
  const generatedId = useId();
  const controlId = htmlFor ?? `${generatedId}-control`;
  const messageId = `${controlId}-message`;
  const counterId = `${controlId}-counter`;

  const hasError = isPresent(error);
  const message = hasError ? error : helperText;
  const hasMessage = isPresent(message);
  const hasCounter = isPresent(counter);

  const describedByIds: string[] = [];
  if (hasMessage) describedByIds.push(messageId);
  if (hasCounter) describedByIds.push(counterId);
  const describedBy = describedByIds.length > 0 ? describedByIds.join(' ') : undefined;

  let control = children;
  if (isValidElement<FieldControlProps>(children)) {
    const ownDescribedBy = children.props['aria-describedby'];
    control = cloneElement(children, {
      'aria-describedby':
        ownDescribedBy !== undefined && describedBy !== undefined
          ? `${ownDescribedBy} ${describedBy}`
          : (ownDescribedBy ?? describedBy),
      // A control that states its own validity wins; otherwise the error drives it.
      'aria-invalid': children.props['aria-invalid'] ?? (hasError || undefined),
      id: children.props.id ?? controlId,
    });
  }

  return (
    <div
      {...fieldProps}
      ref={ref}
      className={cn('flex w-full flex-col gap-sm', className)}
      data-disabled={disabled ? '' : undefined}
      data-invalid={hasError ? '' : undefined}
    >
      {isPresent(label) ? (
        <Label disabled={disabled} htmlFor={controlId} required={required}>
          {label}
        </Label>
      ) : null}

      {control}

      {hasMessage || hasCounter ? (
        <div className="flex items-start gap-sm">
          {hasMessage ? (
            hasError ? (
              // Never colour alone: the red message is paired with an icon.
              <p
                aria-live="polite"
                className="flex items-start gap-xs text-label-sm text-error"
                id={messageId}
              >
                <CircleAlert aria-hidden="true" className="mt-px size-3 shrink-0" />
                {message}
              </p>
            ) : (
              <p className="text-label-sm text-text-muted" id={messageId}>
                {message}
              </p>
            )
          ) : null}

          {hasCounter ? (
            <p className="ms-auto shrink-0 text-label-sm text-text-muted tabular-nums" id={counterId}>
              {counter}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});
