'use client';

import { Button, RadioGroup, RadioGroupCard } from '@bug-bounty-escrow/ui';
import { useEffect, useRef } from 'react';

import { OnboardingCard, OnboardingNote } from './onboarding-shell';
import {
  isSelectableRole,
  ROLE_LABELS,
  SELECTABLE_ROLES,
  SELECTABLE_ROLE_DETAILS,
  type SelectableRole,
} from './role-options';

/**
 * ONB-02 · Account type (79:211), with the selected states 80:159 and 85:302.
 *
 * `RadioGroupCard` is the design-system component for exactly this picker: the whole card is the
 * radio, so Radix supplies arrow-key roving focus and Space, and the selected state differs by
 * border *and* ambient fill *and* a check mark — the three signals §6.4 requires. Radix cancels
 * Enter per the WAI-ARIA radio pattern, but §6.4 names "Tab + Space/Enter" outright, so the
 * keydown handler below restores Enter as a select.
 *
 * The two cards sit side by side from `md` up and stack below it — §11: "Selection cards xếp
 * ngang trên desktop và xếp dọc trên mobile web."
 *
 * Nothing is preselected (§6.4: "Không chọn sẵn role"), so `Continue` stays disabled until the
 * user chooses, matching the disabled primary drawn in 79:211.
 */
export function AccountTypeStep({
  focusSignal,
  onBack,
  onContinue,
  onRoleChange,
  role,
}: {
  /** Bumped by the flow to pull focus back here from the validation card. */
  readonly focusSignal: number;
  readonly onBack: () => void;
  readonly onContinue: () => void;
  readonly onRoleChange: (role: SelectableRole) => void;
  readonly role: SelectableRole | null;
}) {
  const firstCardRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusSignal > 0) firstCardRef.current?.focus();
  }, [focusSignal]);

  return (
    <OnboardingCard
      eyebrow="Step 1 of 3"
      title="Choose your account type"
      subtitle="Select the workspace you want to enter after setup."
      actions={
        <>
          <Button variant="ghost" size="lg" onClick={onBack}>
            Back
          </Button>
          <Button size="lg" disabled={role === null} onClick={onContinue}>
            Continue
          </Button>
        </>
      }
    >
      <RadioGroup
        aria-label="Account type"
        className="gap-lg md:grid-cols-2"
        // Radix stays controlled with a value no item owns, which is how "nothing chosen" is
        // expressed without reaching for `undefined` under exactOptionalPropertyTypes.
        value={role ?? ''}
        onValueChange={(next) => {
          if (isSelectableRole(next)) onRoleChange(next);
        }}
      >
        {SELECTABLE_ROLES.map((selectableRole, index) => (
          <RadioGroupCard
            key={selectableRole}
            ref={(node) => {
              if (index === 0) firstCardRef.current = node;
            }}
            value={selectableRole}
            title={ROLE_LABELS[selectableRole]}
            description={SELECTABLE_ROLE_DETAILS[selectableRole].description}
            onKeyDown={(event) => {
              // Runs before Radix's composed handler, which then cancels the native Enter
              // activation — so this click is the only one and the selection never double-fires.
              if (event.key === 'Enter') event.currentTarget.click();
            }}
          />
        ))}
      </RadioGroup>

      <OnboardingNote>
        <p className="text-label-md text-text-muted">
          Reviewer access is assigned through a trusted workflow and cannot be selected here.
        </p>
      </OnboardingNote>
    </OnboardingCard>
  );
}
