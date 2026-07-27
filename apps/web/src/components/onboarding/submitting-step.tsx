'use client';

import { Button } from '@bug-bounty-escrow/ui';
import { LoaderCircle } from 'lucide-react';

import { OnboardingCard } from './onboarding-shell';
import type { SelectableRole } from './role-options';

/**
 * ONB-05 (81:176) and ONB-05O (85:395).
 *
 * §6.7: both actions are disabled, the button announces `Setting up your workspace…`, and nothing
 * navigates until the API returns the new profile. The primary keeps its width while loading
 * because `Button` hides the label in place rather than replacing it.
 */
export function SubmittingStep({ role }: { readonly role: SelectableRole }) {
  const isOwner = role === 'owner';

  return (
    <OnboardingCard
      eyebrow="Step 3 of 3"
      title={isOwner ? 'Setting up your owner workspace…' : 'Setting up your workspace…'}
      subtitle={
        isOwner
          ? "We're saving your profile and waiting for server confirmation before opening /owner/programs."
          : "We're saving your profile and preparing the researcher workspace."
      }
      actions={
        <>
          <Button variant="ghost" size="lg" disabled>
            Back
          </Button>
          <Button size="lg" loading loadingLabel="Setting up your workspace…">
            Complete setup
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-xl py-xl">
        <LoaderCircle
          aria-hidden="true"
          className="size-2xl text-primary motion-safe:animate-spin"
        />

        <p role="status" className="text-center text-body-sm text-text-muted">
          Do not close this window. You&rsquo;ll continue after the server confirms your role.
        </p>

        {/* Indeterminate: the request has no measurable progress, so no value is reported. */}
        <div
          role="progressbar"
          aria-label="Saving your profile"
          className="h-1 w-full overflow-hidden rounded-full bg-surface-raised"
        >
          <div className="h-full w-1/2 rounded-full bg-primary motion-safe:animate-pulse" />
        </div>

        <p className="text-center text-label-md text-escrow">
          No optimistic redirect — navigation waits for the server response.
        </p>
      </div>
    </OnboardingCard>
  );
}
