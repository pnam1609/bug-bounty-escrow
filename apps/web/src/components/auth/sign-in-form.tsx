'use client';

import { Button, Callout, CheckboxField, Field, Input } from '@bug-bounty-escrow/ui';
import { useRef, useState, type FormEvent } from 'react';

import {
  AuthAlert,
  AuthCard,
  AuthEmailDivider,
  AuthLiveStatus,
  AuthOauthAction,
  AuthSwitch,
} from './auth-card';
import {
  describeAuthFailure,
  validateCurrentPassword,
  validateEmail,
  type AuthFailure,
} from './auth-errors';
import { useAuthRedirect, withReturnTo } from './use-auth-redirect';
import { useAuth } from '@/providers/auth-provider';

/**
 * Figma `Sign In / Form Card` (62:117).
 *
 * Sign-in decides nothing about where the user lands: it hands the access token to
 * `useAuthRedirect`, which asks `GET /api/me` and routes on the server's answer (§6.2).
 */

type Phase = 'idle' | 'redirecting' | 'submitting';

const PHASE_ANNOUNCEMENT: Readonly<Record<Phase, string>> = Object.freeze({
  idle: '',
  redirecting: 'Signed in. Opening your workspace…',
  submitting: 'Signing you in…',
});

export function SignInForm() {
  const auth = useAuth();
  const { safeReturnTo, toWorkspace } = useAuthRedirect();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  const registerHref = withReturnTo('/register', safeReturnTo);
  const busy = phase !== 'idle';
  // The provider reports a missing public config through `auth.error`; there is nothing to submit
  // to until that is fixed, so the form stays inert rather than failing on every attempt.
  const unavailable = auth.error !== null;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextEmailError = validateEmail(email);
    const nextPasswordError = validateCurrentPassword(password);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setFailure(null);

    if (nextEmailError !== null) {
      emailRef.current?.focus();
      return;
    }
    if (nextPasswordError !== null) {
      passwordRef.current?.focus();
      return;
    }

    const client = auth.client;
    if (client === null) {
      setFailure({
        field: null,
        message: 'Authentication is still starting up. Try again in a moment.',
        offerSignIn: false,
      });
      return;
    }

    setPhase('submitting');
    try {
      await auth.signIn(email.trim(), password);
      // The provider keeps the session in React state, which has not re-rendered yet; the client
      // has already persisted it, so read the token from there rather than racing the update.
      const { data } = await client.auth.getSession();
      const accessToken = data.session?.access_token;
      if (accessToken === undefined) {
        throw new Error('Sign-in returned no session');
      }
      setPhase('redirecting');
      // Left in the redirecting phase on purpose: the button must not go idle behind the
      // navigation and invite a second submit.
      await toWorkspace(accessToken);
    } catch (error) {
      const nextFailure = describeAuthFailure(error, 'sign-in');
      if (nextFailure.field === 'email') setEmailError(nextFailure.message);
      else if (nextFailure.field === 'password') setPasswordError(nextFailure.message);
      else setFailure(nextFailure);
      setPhase('idle');
    }
  }

  return (
    <AuthCard
      description="Sign in to manage reports, rewards and funded programs."
      title="Welcome back"
    >
      {unavailable ? <Callout variant="danger">{auth.error}</Callout> : null}

      <AuthOauthAction returnTo={safeReturnTo} />
      <AuthEmailDivider />

      <form className="flex w-full flex-col gap-2xl" noValidate onSubmit={(e) => void submit(e)}>
        {failure === null ? null : <AuthAlert failure={failure} signInHref="/login" />}

        <Field error={emailError} label="Email address">
          <Input
            autoComplete="email"
            name="email"
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError(null);
            }}
            placeholder="you@company.com"
            ref={emailRef}
            required
            size="lg"
            type="email"
            value={email}
          />
        </Field>

        <Field error={passwordError} label="Password">
          <Input
            autoComplete="current-password"
            name="password"
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(null);
            }}
            placeholder="Enter your password"
            ref={passwordRef}
            required
            size="lg"
            type="password"
            value={password}
          />
        </Field>

        <div className="flex flex-wrap items-start justify-between gap-md">
          {/* The Supabase client is created with `persistSession: true`, so this is the standing
              behaviour rather than a choice the form can make. */}
          <CheckboxField
            defaultChecked
            description="Sessions on this device stay signed in."
            disabled
            label="Keep me signed in"
          />
          {/* Placeholder, marked out of MVP scope in §6.2: there is no recovery route yet. */}
          <Button size="md" variant="ghost" className="text-primary">
            Forgot password?
          </Button>
        </div>

        <Button
          className="w-full"
          disabled={unavailable || auth.loading}
          loading={busy}
          loadingLabel="Signing in"
          size="lg"
          type="submit"
        >
          Sign in
        </Button>
      </form>

      <AuthSwitch href={registerHref} label="Create an account" prompt="New to BountyEscrow?" />
      <AuthLiveStatus message={PHASE_ANNOUNCEMENT[phase]} />
    </AuthCard>
  );
}
