'use client';

import {
  onboardingRequestSchema,
  onboardingResponseSchema,
  type ApplicationRole,
} from '@bug-bounty-escrow/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { AccountTypeStep } from './account-type-step';
import { ConfirmStep } from './confirm-step';
import { IntroStep } from './intro-step';
import {
  ConflictCard,
  NetworkErrorCard,
  OnboardingLoadingCard,
  SessionExpiredCard,
  ValidationErrorCard,
} from './onboarding-states';
import { OnboardingShell } from './onboarding-shell';
import { isDisplayNameValid, ProfileDetailsStep } from './profile-details-step';
import { ROLE_LANDING_PATHS, type SelectableRole } from './role-options';
import { SubmittingStep } from './submitting-step';
import { canRoleEnter, readSafeReturnTo } from '@/components/auth/use-auth-redirect';
import { useCurrentUser } from '@/hooks/use-current-user';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

/*
 * The whole `/onboarding` route: ONB-00 through ONB-06, Figma section 79:150.
 *
 * Three rules from docs/flow/onboarding-role-flow-for-figma.md shape this component more than
 * anything else:
 *
 *   §6.7  No optimistic redirect. The route only changes once the API has handed back a profile,
 *         and that profile — never the local selection — decides where the user lands. Both are
 *         satisfied by writing the response into the `me` cache and letting one effect route off
 *         the cached role, so there is a single place where navigation can happen.
 *   §5    Multi-step state survives Back: `role` and `displayName` live here, and only `phase`
 *         moves when the user steps backwards.
 *   §3    Nothing protected is rendered while the session or profile is still loading.
 */

type Phase =
  | 'account-type'
  | 'confirm'
  | 'conflict'
  | 'intro'
  | 'network-error'
  | 'profile'
  | 'session-expired'
  | 'submitting'
  | 'validation';

/** Which rail step each screen belongs to. Every terminal screen sits on "Confirm". */
const RAIL_STEP: Readonly<Record<Phase, number>> = Object.freeze({
  intro: 0,
  'account-type': 0,
  profile: 1,
  confirm: 2,
  submitting: 2,
  validation: 2,
  'network-error': 2,
  conflict: 2,
  'session-expired': 2,
});

/** Phases that replace the card with a message the user has to notice. */
const ANNOUNCED_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  'conflict',
  'network-error',
  'session-expired',
  'validation',
]);

/** Phases whose card cannot render without a chosen role. */
const ROLE_DEPENDENT_PHASES: ReadonlySet<Phase> = new Set<Phase>([
  'confirm',
  'network-error',
  'profile',
  'submitting',
]);

export function OnboardingFlow() {
  const auth = useAuth();
  const user = useCurrentUser();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<Phase>('intro');
  const [role, setRole] = useState<SelectableRole | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [displayNameError, setDisplayNameError] = useState<string | null>(null);
  const [conflictRole, setConflictRole] = useState<ApplicationRole | null>(null);
  const [isResolvingConflict, setIsResolvingConflict] = useState(false);

  // Bumping a counter is what asks a step to take focus; the step owns the element, this owns the
  // decision about when focus should move.
  const [accountTypeFocus, setAccountTypeFocus] = useState(0);
  const [profileFocus, setProfileFocus] = useState(0);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const announcedPhaseRef = useRef<Phase | null>(null);

  const isBootstrapping = auth.loading || (auth.session !== null && user.isLoading);
  // A missing session outranks whatever step the wizard thinks it is on: there is nothing to
  // submit and no amount of retrying will fix it (§6.8, "Không submit lại vô hạn").
  const resolvedPhase: Phase = !auth.loading && auth.session === null ? 'session-expired' : phase;
  const effectivePhase: Phase =
    role === null && ROLE_DEPENDENT_PHASES.has(resolvedPhase) ? 'account-type' : resolvedPhase;

  const completedRole =
    user.data !== undefined && user.data.onboardingComplete ? user.data.role : null;
  const isLeaving = completedRole !== null && effectivePhase !== 'conflict';

  // The single navigation site. Whether the profile arrived from `GET /api/me` on load or from the
  // `PATCH` response written into the cache, the destination comes from the server's role. A safe
  // internal `returnTo` the role may enter wins over the landing page, so the journey that started
  // at e.g. `Submit a private report` ends back at that composer (onboarding flow §6.2 step 5, §8).
  // `window` is available because effects only run in the browser; the query string is read here
  // instead of `useSearchParams` so the route needs no Suspense boundary.
  useEffect(() => {
    if (completedRole !== null && effectivePhase !== 'conflict') {
      const returnTo = readSafeReturnTo(
        new URLSearchParams(window.location.search).get('returnTo'),
      );

      router.replace(
        returnTo !== null && canRoleEnter(completedRole, returnTo)
          ? returnTo
          : ROLE_LANDING_PATHS[completedRole],
      );
    }
  }, [completedRole, effectivePhase, router]);

  // Move focus onto the heading when the card is swapped for a message, but never on the first
  // paint — landing on a page should not yank focus out of the browser chrome.
  useEffect(() => {
    if (isBootstrapping || isLeaving) return;
    const previous = announcedPhaseRef.current;
    announcedPhaseRef.current = effectivePhase;
    if (previous !== null && previous !== effectivePhase && ANNOUNCED_PHASES.has(effectivePhase)) {
      headingRef.current?.focus();
    }
  }, [effectivePhase, isBootstrapping, isLeaving]);

  async function submit(): Promise<void> {
    // Re-validated against the wire contract rather than the local guards, so `reviewer` or an
    // over-long name can never leave the browser even if a step is bypassed.
    const parsed = onboardingRequestSchema.safeParse({ displayName, role });
    if (!parsed.success) {
      setPhase('validation');
      return;
    }

    const token = auth.session?.access_token;
    if (token === undefined) {
      setPhase('session-expired');
      return;
    }

    setPhase('submitting');

    try {
      const response = await apiRequest('/api/me/onboarding', onboardingResponseSchema, {
        method: 'PATCH',
        token,
        body: parsed.data,
      });
      // No `router.replace` here: seeding the cache is what tells the effect above that a real
      // profile exists, and the effect routes by the role that profile carries.
      queryClient.setQueryData(queryKeys.me(response.data.id), response.data);
    } catch (error) {
      if (!(error instanceof ApiClientError)) {
        setPhase('network-error');
        return;
      }
      if (error.status === 401 || error.status === 403) {
        setPhase('session-expired');
        return;
      }
      if (error.status === 409 || error.code === 'onboarding_already_completed') {
        // Already set up with different values. Never offer an overwrite — re-read the profile and
        // send the user to whichever workspace the server says is theirs (§6.8).
        setPhase('conflict');
        setConflictRole(null);
        setIsResolvingConflict(true);
        const refreshed = await user.refetch();
        setConflictRole(refreshed.data?.role ?? null);
        setIsResolvingConflict(false);
        return;
      }
      setPhase('network-error');
    }
  }

  function continueFromProfile(): void {
    if (!isDisplayNameValid(displayName)) {
      setDisplayNameError('Enter a display name.');
      setProfileFocus((value) => value + 1);
      return;
    }
    setDisplayNameError(null);
    setPhase('confirm');
  }

  function reviewInvalidField(): void {
    if (role === null) {
      setPhase('account-type');
      setAccountTypeFocus((value) => value + 1);
      return;
    }
    setDisplayNameError('Enter a display name.');
    setPhase('profile');
    setProfileFocus((value) => value + 1);
  }

  if (isBootstrapping) {
    return (
      <OnboardingShell currentStep={RAIL_STEP[effectivePhase]}>
        <OnboardingLoadingCard />
      </OnboardingShell>
    );
  }

  if (isLeaving) {
    return (
      <OnboardingShell currentStep={RAIL_STEP[effectivePhase]}>
        <OnboardingLoadingCard label="Opening your workspace…" />
      </OnboardingShell>
    );
  }

  let card: ReactNode;
  if (effectivePhase === 'session-expired') {
    card = <SessionExpiredCard headingRef={headingRef} />;
  } else if (effectivePhase === 'conflict') {
    card = (
      <ConflictCard
        headingRef={headingRef}
        isResolving={isResolvingConflict}
        serverRole={conflictRole}
        onContinue={() => {
          // `/programs` is the public listing every signed-in role may read, so it is the safe
          // destination when the re-read could not tell us the role.
          router.replace(conflictRole === null ? '/programs' : ROLE_LANDING_PATHS[conflictRole]);
        }}
      />
    );
  } else if (effectivePhase === 'validation') {
    card = (
      <ValidationErrorCard
        displayName={displayName}
        headingRef={headingRef}
        role={role}
        onBack={() => setPhase(role === null ? 'account-type' : 'confirm')}
        onReview={reviewInvalidField}
      />
    );
  } else if (effectivePhase === 'intro') {
    card = <IntroStep onStart={() => setPhase('account-type')} />;
  } else if (effectivePhase === 'account-type' || role === null) {
    card = (
      <AccountTypeStep
        focusSignal={accountTypeFocus}
        role={role}
        onBack={() => setPhase('intro')}
        onContinue={() => setPhase('profile')}
        onRoleChange={setRole}
      />
    );
  } else if (effectivePhase === 'profile') {
    card = (
      <ProfileDetailsStep
        displayName={displayName}
        error={displayNameError}
        focusSignal={profileFocus}
        role={role}
        onBack={() => setPhase('account-type')}
        onContinue={continueFromProfile}
        onDisplayNameChange={(value) => {
          setDisplayName(value);
          if (displayNameError !== null && isDisplayNameValid(value)) setDisplayNameError(null);
        }}
      />
    );
  } else if (effectivePhase === 'submitting') {
    card = <SubmittingStep role={role} />;
  } else if (effectivePhase === 'network-error') {
    card = (
      <NetworkErrorCard
        displayName={displayName}
        headingRef={headingRef}
        role={role}
        onBack={() => setPhase('confirm')}
        onRetry={() => void submit()}
      />
    );
  } else {
    card = (
      <ConfirmStep
        displayName={displayName.trim()}
        role={role}
        onBack={() => setPhase('profile')}
        onComplete={() => void submit()}
      />
    );
  }

  return <OnboardingShell currentStep={RAIL_STEP[effectivePhase]}>{card}</OnboardingShell>;
}
