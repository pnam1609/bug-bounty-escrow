'use client';

import type { ApplicationRole } from '@bug-bounty-escrow/shared';
import { Button, Callout, Card } from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import { useEffect, useState, type Ref } from 'react';

import { OnboardingCard } from './onboarding-shell';
import { ROLE_LABELS, SUPPORT_HREF, type SelectableRole } from './role-options';
import { buildSessionExpiredLoginHref } from '@/components/auth/use-auth-redirect';

/*
 * The non-form screens of the flow: ONB-00 and the four ONB-06 recovery frames.
 *
 * Every message here is the one docs/flow/onboarding-role-flow-for-figma.md §6.8 assigns to the
 * case, so the wording a user sees matches the wording the spec table promises. Each card takes a
 * `headingRef` because the flow moves focus to the heading when it swaps one in — a silent card
 * swap is invisible to anyone not looking at the middle of the screen.
 */

/** ONB-00 · Loading (79:151). Skeleton only — never a glimpse of a screen the profile may forbid. */
export function OnboardingLoadingCard({
  label = 'Loading your profile…',
}: {
  readonly label?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-lg">
      <Card padding="lg" className="gap-2xl" aria-hidden="true">
        <div className="flex flex-col gap-md">
          <div className="h-3 w-36 rounded-full bg-surface-raised motion-safe:animate-pulse" />
          <div className="h-8 w-96 max-w-full rounded-md bg-surface-raised motion-safe:animate-pulse" />
          <div className="h-3 w-full rounded-full bg-surface-raised motion-safe:animate-pulse" />
          <div className="h-3 w-2/3 rounded-full bg-surface-raised motion-safe:animate-pulse" />
        </div>
        <div className="h-24 w-full rounded-md bg-surface-raised motion-safe:animate-pulse" />
        <div className="flex justify-end">
          <div className="h-11 w-44 rounded-full bg-surface-raised motion-safe:animate-pulse" />
        </div>
      </Card>
      <p role="status" className="text-center text-body-sm text-text-muted">
        {label}
      </p>
    </div>
  );
}

/** Label + value row used by the retained-data and existing-workspace panels. */
function SummaryRow({
  label,
  tone = 'default',
  value,
}: {
  readonly label: string;
  readonly tone?: 'default' | 'error' | undefined;
  readonly value: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-md">
      <span className="text-body-sm text-text">{label}</span>
      <span
        className={tone === 'error' ? 'text-body-sm text-error' : 'text-body-sm text-text-muted'}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * ONB-06V · Validation error (81:211). Reached only from the submit guard, so it names both fields
 * and hands focus back to the first one that is missing.
 */
export function ValidationErrorCard({
  displayName,
  headingRef,
  onBack,
  onReview,
  role,
}: {
  readonly displayName: string;
  readonly headingRef?: Ref<HTMLHeadingElement> | undefined;
  readonly onBack: () => void;
  readonly onReview: () => void;
  readonly role: SelectableRole | null;
}) {
  const hasDisplayName = displayName.trim().length > 0;

  return (
    <OnboardingCard
      eyebrow="Step 3 of 3"
      headingRef={headingRef}
      title="Complete the required fields"
      subtitle="Choose an account type and enter a display name."
      actions={
        <>
          <Button variant="ghost" size="lg" onClick={onBack}>
            Back
          </Button>
          <Button size="lg" onClick={onReview}>
            Review fields
          </Button>
        </>
      }
    >
      <Callout variant="danger" title="We need a little more information">
        Choose an account type and enter a display name.
      </Callout>

      <Card variant="subtle" padding="md" className="border-error">
        <SummaryRow
          label="Account type"
          tone={role === null ? 'error' : 'default'}
          value={role === null ? 'No option selected' : ROLE_LABELS[role]}
        />
        <SummaryRow
          label="Display name"
          tone={hasDisplayName ? 'default' : 'error'}
          value={hasDisplayName ? displayName.trim() : 'Required'}
        />
      </Card>
    </OnboardingCard>
  );
}

/**
 * ONB-06N · Network error (81:252). §6.8 keeps the form intact and retries the *same* request —
 * the RPC treats an identical role and display name as a retry, never a second profile.
 */
export function NetworkErrorCard({
  displayName,
  headingRef,
  onBack,
  onRetry,
  role,
}: {
  readonly displayName: string;
  readonly headingRef?: Ref<HTMLHeadingElement> | undefined;
  readonly onBack: () => void;
  readonly onRetry: () => void;
  readonly role: SelectableRole;
}) {
  return (
    <OnboardingCard
      eyebrow="Step 3 of 3"
      headingRef={headingRef}
      title="We couldn't save your profile"
      subtitle="Your selections are still here. Try the same request again."
      actions={
        <>
          <Button variant="ghost" size="lg" onClick={onBack}>
            Back
          </Button>
          <Button size="lg" onClick={onRetry}>
            Try again
          </Button>
        </>
      }
    >
      <Callout variant="danger" title="Network error">
        We couldn&rsquo;t save your profile. Try again.
      </Callout>

      <Card variant="subtle" padding="md" className="gap-sm">
        <p className="text-label-sm font-semibold uppercase text-text-muted">Retained data</p>
        <p className="text-h3 text-text">{ROLE_LABELS[role]}</p>
        <p className="text-body-sm text-text-muted">{displayName.trim()}</p>
        <p className="text-label-md text-escrow">
          Retry uses the same data — no duplicate profile is created.
        </p>
      </Card>
    </OnboardingCard>
  );
}

/**
 * ONB-06C · Conflict (81:293). The account was already set up with different values, so the only
 * way forward is the workspace the *server* reports — there is deliberately no overwrite action.
 */
export function ConflictCard({
  headingRef,
  isResolving,
  onContinue,
  serverRole,
}: {
  readonly headingRef?: Ref<HTMLHeadingElement> | undefined;
  /** True while `/api/me` is being re-read after the 409. */
  readonly isResolving: boolean;
  readonly onContinue: () => void;
  /** The role the server reports. Never the one the user tried to send. */
  readonly serverRole: ApplicationRole | null;
}) {
  return (
    <OnboardingCard
      eyebrow="Step 3 of 3"
      headingRef={headingRef}
      title="Your account is already set up"
      subtitle="We found an existing workspace for this signed-in account."
      actions={
        <>
          <Button variant="secondary" size="lg" asChild>
            <Link href={SUPPORT_HREF}>Contact support</Link>
          </Button>
          <Button
            size="lg"
            loading={isResolving}
            loadingLabel="Reading your workspace…"
            onClick={onContinue}
          >
            Continue to workspace
          </Button>
        </>
      }
    >
      <Callout variant="info" role="status" title="Profile conflict resolved safely">
        Your account has already been set up. Continue to your workspace.
      </Callout>

      <Card variant="subtle" padding="md" className="gap-sm">
        <p className="text-label-sm font-semibold uppercase text-text-muted">Existing workspace</p>
        <p className="text-h3 text-text">
          {serverRole === null
            ? isResolving
              ? 'Checking your account…'
              : 'Your existing workspace'
            : ROLE_LABELS[serverRole]}
        </p>
        <p className="text-label-md text-escrow">No permissions were overwritten.</p>
      </Card>
    </OnboardingCard>
  );
}

/** ONB-06S · Session expired (81:333). Also the anonymous landing: never a retry loop, always a CTA. */
export function SessionExpiredCard({
  headingRef,
}: {
  readonly headingRef?: Ref<HTMLHeadingElement> | undefined;
}) {
  // The query string is read in an effect because this card is also server-rendered. Until the
  // effect runs, the link is the no-`returnTo` form — exactly what the server markup carries.
  const [loginHref, setLoginHref] = useState(() => buildSessionExpiredLoginHref(''));

  useEffect(() => {
    setLoginHref(buildSessionExpiredLoginHref(window.location.search));
  }, []);

  return (
    <OnboardingCard
      eyebrow="Step 3 of 3"
      headingRef={headingRef}
      title="Sign in to continue"
      subtitle="Your secure session is no longer active."
      actions={
        <Button size="lg" asChild>
          <Link href={loginHref}>Back to sign in</Link>
        </Button>
      }
    >
      <Callout variant="warning" role="alert" title="Session expired">
        Your session expired. Sign in again to continue.
      </Callout>

      <p className="text-body-sm text-text-muted">
        After signing in, we&rsquo;ll return you to onboarding without showing a protected screen
        first.
      </p>
    </OnboardingCard>
  );
}
