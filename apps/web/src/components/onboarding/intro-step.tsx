'use client';

import { Button } from '@bug-bounty-escrow/ui';

import { OnboardingCard, OnboardingNote } from './onboarding-shell';

/**
 * ONB-01 · Intro (79:180).
 *
 * Copy is verbatim from docs/flow/onboarding-role-flow-for-figma.md §6.3, which the Figma frame
 * matches. §6.3 also rules out mentioning blockchain, wallet or reviewer here.
 */
export function IntroStep({ onStart }: { readonly onStart: () => void }) {
  return (
    <OnboardingCard
      eyebrow="One last step"
      title="How will you participate?"
      subtitle="Choose the workspace that matches what you want to do first. Your account type cannot be changed by yourself after setup."
      actions={
        <Button size="lg" onClick={onStart}>
          Get started
        </Button>
      }
    >
      <OnboardingNote>
        <p className="text-label-lg font-semibold text-text">One account, one role in the MVP</p>
        <p className="text-body-sm text-text-muted">
          You can update your display name later. Account type changes require support.
        </p>
      </OnboardingNote>
    </OnboardingCard>
  );
}
