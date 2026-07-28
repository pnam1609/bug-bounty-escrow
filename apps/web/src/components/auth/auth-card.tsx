'use client';

import {
  Button,
  Callout,
  Card,
  CardDescription,
  CardHeader,
  Separator,
} from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import { useState, type ReactNode, type Ref } from 'react';

import type { AuthFailure } from './auth-errors';
import { buildGoogleOAuthCallbackUrl } from './oauth';
import { useAuth } from '@/providers/auth-provider';

/**
 * The pieces both auth cards share: Figma `Sign In / Form Card` (62:117) and
 * `Sign Up / Form Card` (62:120) are the same surface with a different field set.
 *
 * The card is the page's main content, so its title is the `h1`; `CardTitle` renders an `h3` and
 * would leave the screen without a top-level heading.
 */

export interface AuthCardProps {
  readonly children: ReactNode;
  readonly description: string;
  readonly title: string;
  /**
   * Lets a caller move focus to the heading when the card swaps to a different step — a screen
   * reader is otherwise never told that the form it was filling in has been replaced.
   */
  readonly titleRef?: Ref<HTMLHeadingElement> | undefined;
}

export function AuthCard({ children, description, title, titleRef }: AuthCardProps) {
  return (
    <Card variant="subtle" padding="lg" className="w-full shadow-elevated">
      <CardHeader className="gap-sm">
        {/* Not in the tab order; reachable only when the card hands focus here deliberately. */}
        <h1 className="text-h1 text-text" ref={titleRef} tabIndex={-1}>
          {title}
        </h1>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {children}
    </Card>
  );
}

/**
 * The shared Google action used by sign-in and registration. Supabase owns the provider exchange;
 * the app callback only receives the resulting session and applies BBE's role-aware routing.
 */
export function AuthOauthAction({ returnTo }: { readonly returnTo: string | null }) {
  const auth = useAuth();
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function continueWithGoogle(): Promise<void> {
    setFailure(null);
    setLoading(true);

    try {
      await auth.signInWithGoogle(buildGoogleOAuthCallbackUrl(window.location.origin, returnTo));
      // Successful OAuth navigation leaves this document. Keep the button busy until that happens
      // so a slow provider redirect cannot be started twice.
    } catch {
      setFailure('Google sign-in could not be started. Please try again.');
      setLoading(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-sm">
      {failure === null ? null : <Callout variant="danger">{failure}</Callout>}
      <Button
        className="w-full"
        disabled={auth.error !== null || auth.loading}
        loading={loading}
        loadingLabel="Opening Google sign-in"
        onClick={() => void continueWithGoogle()}
        size="lg"
        variant="secondary"
      >
        Continue with Google
      </Button>
    </div>
  );
}

export function AuthEmailDivider() {
  return (
    <div className="flex w-full items-center gap-md">
      <Separator className="w-auto flex-1" />
      <p className="text-label-sm text-text-muted">OR CONTINUE WITH EMAIL</p>
      <Separator className="w-auto flex-1" />
    </div>
  );
}

export interface AuthSwitchProps {
  readonly href: string;
  readonly label: string;
  readonly prompt: string;
}

/** "New to BountyEscrow? Create an account" — its own row, so the link clears a 44px target. */
export function AuthSwitch({ href, label, prompt }: AuthSwitchProps) {
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-xs">
      <span className="text-body-sm text-text-muted">{prompt}</span>
      <Link
        className="inline-flex min-h-11 items-center rounded-sm text-label-lg text-primary hover:underline"
        href={href}
      >
        {label}
      </Link>
    </div>
  );
}

export interface AuthAlertProps {
  readonly failure: AuthFailure;
  readonly signInHref: string;
}

/** Form-level failure. `Callout variant="danger"` carries `role="alert"` and an icon of its own. */
export function AuthAlert({ failure, signInHref }: AuthAlertProps) {
  return (
    <Callout variant="danger">
      <p>{failure.message}</p>
      {failure.offerSignIn ? (
        <Button asChild className="mt-sm" size="md" variant="ghost">
          <Link href={signInHref}>Sign in instead</Link>
        </Button>
      ) : null}
    </Callout>
  );
}

/**
 * Announces submit progress and the hand-off to the workspace. Visually silent — the button's own
 * spinner is the sighted cue — but §11 of the flow doc requires the routing state to be spoken.
 */
export function AuthLiveStatus({ message }: { readonly message: string }) {
  return (
    <p aria-live="polite" className="sr-only" role="status">
      {message}
    </p>
  );
}
