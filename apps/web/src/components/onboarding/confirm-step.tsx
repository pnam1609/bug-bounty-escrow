'use client';

import { Button, Callout, Card } from '@bug-bounty-escrow/ui';
import { Check } from 'lucide-react';

import { OnboardingCard } from './onboarding-shell';
import {
  RoleBadge,
  ROLE_LABELS,
  SELECTABLE_ROLE_DETAILS,
  type SelectableRole,
} from './role-options';

/**
 * ONB-04R (80:254) and ONB-04O (82:185).
 *
 * §6.6 requires the chosen account type, the display name, two to three workspace capabilities and
 * a soft warning that the type cannot be self-changed. The warning copy is the doc's full sentence
 * — Figma truncates it, and the doc wins.
 */
export function ConfirmStep({
  displayName,
  onBack,
  onComplete,
  role,
}: {
  readonly displayName: string;
  readonly onBack: () => void;
  readonly onComplete: () => void;
  readonly role: SelectableRole;
}) {
  return (
    <OnboardingCard
      eyebrow="Step 3 of 3"
      title="Confirm your setup"
      subtitle="Review the workspace details before completing setup."
      actions={
        <>
          <Button variant="ghost" size="lg" onClick={onBack}>
            Back
          </Button>
          <Button size="lg" onClick={onComplete}>
            Complete setup
          </Button>
        </>
      }
    >
      <Card variant="subtle" padding="md">
        <div className="flex items-start justify-between gap-lg">
          <div className="flex min-w-0 flex-col gap-xs">
            <p className="text-label-sm font-semibold uppercase text-text-muted">Account type</p>
            <p className="text-h3 text-text">{ROLE_LABELS[role]}</p>
          </div>
          <RoleBadge role={role} />
        </div>
        <div className="flex flex-col gap-xs">
          <p className="text-label-sm font-semibold uppercase text-text-muted">Display name</p>
          <p className="text-body text-text">{displayName}</p>
        </div>
      </Card>

      <div className="flex flex-col gap-md">
        <p className="text-label-sm font-semibold uppercase text-text-muted">
          Your workspace includes
        </p>
        <ul className="flex flex-col gap-sm">
          {SELECTABLE_ROLE_DETAILS[role].capabilities.map((capability) => (
            <li key={capability} className="flex items-center gap-md">
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-escrow [color:var(--color-background)]"
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
              <span className="text-body-sm text-text">{capability}</span>
            </li>
          ))}
        </ul>
      </div>

      <Callout variant="warning">
        You can edit your display name later. To use a different account type in the MVP, contact
        support; do not create or overwrite permissions from this screen.
      </Callout>
    </OnboardingCard>
  );
}
