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
import { useId, type ReactNode, type Ref } from 'react';

import type { AuthFailure } from './auth-errors';

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
 * The frame's "Continue with Google" action. `auth-provider.tsx` exposes password sign-in only and
 * no OAuth provider is configured, so the control is drawn as designed but disabled, with the
 * reason in text next to it rather than left as a dead affordance.
 */
export function AuthOauthAction() {
  const noteId = useId();

  return (
    <div className="flex w-full flex-col gap-sm">
      <Button aria-describedby={noteId} className="w-full" disabled size="lg" variant="secondary">
        Continue with Google
      </Button>
      <p className="text-label-sm text-text-muted" id={noteId}>
        Google sign-in is not enabled yet. Continue with your email address below.
      </p>
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
