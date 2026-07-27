'use client';

import { Button, Callout, cn, Field, Input, type InputSize } from '@bug-bounty-escrow/ui';
import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

/*
 * Pieces every wizard step repeats — Figma 95:318 and flow doc §5. The form card is the 800px
 * surface at x=48 in each `Workspace Main`; the action row is the card's sticky footer: it stays
 * inside the card but rides the viewport bottom while a long step scrolls.
 */

export function FormCard({
  children,
  description,
  title,
}: {
  readonly children: ReactNode;
  readonly description?: string;
  readonly title: string;
}) {
  return (
    <section className="flex flex-col gap-xl rounded-lg border border-border bg-surface p-2xl shadow-subtle">
      <header className="flex flex-col gap-sm">
        <h2 className="text-h2 text-text">{title}</h2>
        {description === undefined ? null : (
          <p className="text-body-sm text-text-muted">{description}</p>
        )}
      </header>
      {children}
    </section>
  );
}

/**
 * Sticky action footer inside the form card (§5): 32px above, right-aligned, secondary before
 * primary. Negative margins bleed the bar across the card's `p-2xl` so fields scroll underneath
 * an opaque `surface` strip instead of past floating buttons.
 */
export function StepActions({
  primaryLabel,
  onPrimary,
  pending = false,
  pendingLabel,
  secondaryLabel,
  onSecondary,
}: {
  readonly primaryLabel: string;
  readonly onPrimary: () => void;
  readonly pending?: boolean;
  readonly pendingLabel?: string;
  readonly secondaryLabel: string;
  readonly onSecondary: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 mt-2xl -mx-2xl -mb-2xl flex flex-wrap items-center justify-end gap-md rounded-b-lg border-t border-border bg-surface px-2xl py-md">
      <Button disabled={pending} onClick={onSecondary} size="lg" variant="ghost">
        {secondaryLabel}
      </Button>
      <Button disabled={pending} loading={pending} onClick={onPrimary} size="lg">
        {pending && pendingLabel !== undefined ? pendingLabel : primaryLabel}
      </Button>
    </div>
  );
}

/**
 * CP-01V / CP-02V / CP-02IV / CP-03V / CP-03RV summary strip. `Callout variant="danger"` already
 * carries `role="alert"`, so the message is announced the moment a step submit fails.
 */
export function ValidationSummary({ detail }: { readonly detail?: string | undefined }) {
  return (
    <Callout title="Review the highlighted fields before continuing." variant="danger">
      {detail ?? 'Each field below explains what needs to change.'}
    </Callout>
  );
}

/**
 * `Field` injects the control id and the aria wiring into whichever element it is given, so a
 * prefix/suffix wrapper would steal them from the real input. Everything that needs an affix goes
 * through this component instead: the wrapper keeps its own id and the input keeps the field id
 * plus an explicit `aria-describedby` pointing at the ids `Field` renders.
 */
export function AffixedField({
  className,
  counter,
  disabled = false,
  error,
  helperText,
  id,
  inputMode,
  label,
  maxLength,
  onChange,
  placeholder,
  prefix,
  required = false,
  size = 'md',
  suffix,
  type,
  value,
}: {
  readonly className?: string;
  readonly counter?: ReactNode;
  readonly disabled?: boolean;
  readonly error?: string | undefined;
  readonly helperText?: ReactNode;
  readonly id: string;
  readonly inputMode?: 'decimal' | 'numeric' | 'url';
  readonly label: ReactNode;
  readonly maxLength?: number;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly prefix?: string;
  readonly required?: boolean;
  readonly size?: InputSize;
  readonly suffix?: string;
  readonly type?: 'text' | 'url';
  readonly value: string;
}) {
  const describedBy = [
    error !== undefined || helperText !== undefined ? `${id}-message` : null,
    counter === undefined ? null : `${id}-counter`,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(' ');

  const affix =
    'inline-flex shrink-0 items-center bg-surface-raised px-md text-label-md text-text-muted';

  return (
    <Field
      className={className}
      counter={counter}
      disabled={disabled}
      error={error}
      helperText={helperText}
      htmlFor={id}
      label={label}
      required={required}
    >
      <div className="flex w-full items-stretch" id={`${id}-group`}>
        {prefix === undefined ? null : (
          <span
            aria-hidden="true"
            className={cn(affix, 'rounded-s-md border border-e-0 border-input-border')}
          >
            {prefix}
          </span>
        )}
        <Input
          aria-describedby={describedBy === '' ? undefined : describedBy}
          aria-invalid={error === undefined ? undefined : true}
          className={cn(
            prefix === undefined ? null : 'rounded-s-none',
            suffix === undefined ? null : 'rounded-e-none',
          )}
          disabled={disabled}
          id={id}
          {...(inputMode === undefined ? {} : { inputMode })}
          {...(maxLength === undefined ? {} : { maxLength })}
          onChange={(event) => onChange(event.target.value)}
          {...(placeholder === undefined ? {} : { placeholder })}
          size={size}
          {...(type === undefined ? {} : { type })}
          value={value}
        />
        {suffix === undefined ? null : (
          <span
            aria-hidden="true"
            className={cn(affix, 'rounded-e-md border border-s-0 border-input-border')}
          >
            {suffix}
          </span>
        )}
      </div>
    </Field>
  );
}

/** Destructive row action. Lucide `trash-2` with a real accessible name, sized to the 44px target. */
export function DeleteRowButton({
  className,
  label,
  onClick,
}: {
  readonly className?: string;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-border',
        'bg-surface-raised text-text-muted transition-colors',
        'hover:border-error hover:text-error motion-reduce:transition-none',
        className,
      )}
      onClick={onClick}
      type="button"
    >
      <Trash2 aria-hidden="true" className="size-4" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

/** Small text action used for `Edit`, `+ Add tag` and the review section jump links. */
export function InlineAction({
  children,
  className,
  onClick,
  tone = 'primary',
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly onClick: () => void;
  readonly tone?: 'primary' | 'danger';
}) {
  return (
    <button
      className={cn(
        'inline-flex min-h-11 items-center rounded-sm px-xs text-label-lg underline-offset-4 hover:underline',
        tone === 'danger' ? 'text-error' : 'text-primary',
        className,
      )}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * §5 Desktop shell — every screen in the create-program flow stacks heading → stepper → step
 * content on the 32px rhythm inside a content column capped at 1120px in `Workspace Main`.
 */
export function WizardShell({ children }: { readonly children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-2xl">{children}</div>;
}

/** Two-column body: the 800px form card beside the 304px guidance rail. */
export function StepLayout({
  aside,
  children,
}: {
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-2xl xl:grid-cols-[minmax(0,1fr)_304px]">
      <div className="flex min-w-0 flex-col gap-xl">{children}</div>
      {aside}
    </div>
  );
}

/** A labelled row inside a summary panel: label on the left, value hard right. */
export function SummaryRow({
  label,
  value,
}: {
  readonly label: ReactNode;
  readonly value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-lg border-t border-border py-md text-body-sm first:border-t-0">
      <span className="text-text-muted">{label}</span>
      <span className="text-right text-text">{value}</span>
    </div>
  );
}
