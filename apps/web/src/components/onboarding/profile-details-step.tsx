'use client';

import { Button, Field, Input } from '@bug-bounty-escrow/ui';
import { useEffect, useId, useRef } from 'react';

import { OnboardingCard, OnboardingNote } from './onboarding-shell';
import { ROLE_LABELS, type SelectableRole } from './role-options';

/** §6.5: 1–120 characters after trimming. Mirrors `onboardingRequestSchema.displayName`. */
export const DISPLAY_NAME_MAX_LENGTH = 120;

export function isDisplayNameValid(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= DISPLAY_NAME_MAX_LENGTH;
}

/**
 * ONB-03 · Profile details (80:206) and ONB-03O · Owner profile (85:348).
 *
 * §6.5 asks for one required field and forbids a wallet prompt. `Field` owns the aria plumbing —
 * it gives the input an id, points `aria-describedby` at the helper, counter and error, and flips
 * `aria-invalid` — so the error is linked and announced without a second wiring pass.
 *
 * The two frames disagree on the note beneath the field: 80:206 shows the character rule, 85:348
 * shows the selected account type. Both are useful and both are true, so both are rendered.
 */
export function ProfileDetailsStep({
  displayName,
  error,
  focusSignal,
  onBack,
  onContinue,
  onDisplayNameChange,
  role,
}: {
  readonly displayName: string;
  readonly error: string | null;
  /** Bumped by the flow to pull focus back here from the validation card. */
  readonly focusSignal: number;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onDisplayNameChange: (value: string) => void;
  readonly role: SelectableRole;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const isOwner = role === 'owner';

  useEffect(() => {
    if (focusSignal > 0) inputRef.current?.focus();
  }, [focusSignal]);

  return (
    <OnboardingCard
      eyebrow="Step 2 of 3"
      title={isOwner ? 'Set up your owner profile' : 'Set up your profile'}
      subtitle={
        isOwner
          ? 'This name appears to researchers and reviewers in your workspace.'
          : 'Tell collaborators how to identify you in the workspace.'
      }
      actions={
        <>
          <Button variant="ghost" size="lg" onClick={onBack}>
            Back
          </Button>
          <Button size="lg" onClick={onContinue}>
            Continue
          </Button>
        </>
      }
    >
      <Field
        htmlFor={inputId}
        label="Display name"
        required
        helperText="This name is shown in your workspace. You can update the display name later."
        counter={`${displayName.trim().length}/${DISPLAY_NAME_MAX_LENGTH}`}
        error={error}
      >
        <Input
          ref={inputRef}
          size="lg"
          name="displayName"
          autoComplete="name"
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          value={displayName}
          onChange={(event) => onDisplayNameChange(event.target.value)}
        />
      </Field>

      <OnboardingNote>
        <p className="text-label-md text-primary">Selected account type: {ROLE_LABELS[role]}</p>
        <p className="text-label-md text-text-muted">
          1–120 characters · leading and trailing spaces are removed
        </p>
      </OnboardingNote>
    </OnboardingCard>
  );
}
