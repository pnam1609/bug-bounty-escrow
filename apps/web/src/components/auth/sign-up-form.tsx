'use client';

import { Button, Callout, CheckboxField, Field, Input } from '@bug-bounty-escrow/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

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
  validateEmail,
  validateNewPassword,
  validateTermsAccepted,
  type AuthFailure,
} from './auth-errors';
import { rememberConfirmationEmail } from './check-email-card';
import { useAuthRedirect, withReturnTo } from './use-auth-redirect';
import { useAuth } from '@/providers/auth-provider';

/**
 * Figma `Sign Up / Form Card` (62:120).
 *
 * No account type here. Role is chosen in onboarding, once a session exists, so the choice is
 * attributable to an authenticated user and lands in the audit log (§6.1).
 */

type Phase = 'confirm-email' | 'idle' | 'redirecting' | 'submitting';

const PHASE_ANNOUNCEMENT: Readonly<Record<Phase, string>> = Object.freeze({
  'confirm-email': 'Account created. Opening the email confirmation instructions…',
  idle: '',
  redirecting: 'Account created. Opening account setup…',
  submitting: 'Creating your account…',
});

export function SignUpForm() {
  const auth = useAuth();
  const router = useRouter();
  const { safeReturnTo } = useAuthRedirect();

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const termsRef = useRef<HTMLButtonElement>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [failure, setFailure] = useState<AuthFailure | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');

  const signInHref = withReturnTo('/login', safeReturnTo);
  const busy = phase !== 'idle';
  const unavailable = auth.error !== null;
  // "Already registered" is the one failure that belongs on a field *and* carries a recovery
  // action, so it is held apart from the plain form-level alert.
  const takenFailure =
    failure !== null && failure.field === 'email' && failure.offerSignIn ? failure : null;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const nextEmailError = validateEmail(email);
    const nextPasswordError = validateNewPassword(password);
    const nextTermsError = validateTermsAccepted(acceptedTerms);
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setTermsError(nextTermsError);
    setFailure(null);

    if (nextEmailError !== null) {
      emailRef.current?.focus();
      return;
    }
    if (nextPasswordError !== null) {
      passwordRef.current?.focus();
      return;
    }
    if (nextTermsError !== null) {
      termsRef.current?.focus();
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

    const address = email.trim();
    setPhase('submitting');
    try {
      await auth.signUp(address, password);
      const { data } = await client.auth.getSession();

      if (data.session === null) {
        // Email confirmation is switched on for this project: there is no session until the link
        // is opened, so the journey pauses at AUTH-03 (`/register/check-email`, §5) instead of
        // pretending to be signed in. The address rides over in sessionStorage rather than in the
        // URL, where it would land in browser history and request logs.
        rememberConfirmationEmail(address);
        setPhase('confirm-email');
        router.push(withReturnTo('/register/check-email', safeReturnTo));
        return;
      }

      setPhase('redirecting');
      // A brand-new account is never onboarded, so the §6.2 profile lookup could only ever answer
      // "/onboarding". Going straight there keeps a created account from stalling behind a failed
      // profile call.
      router.replace('/onboarding');
    } catch (error) {
      const nextFailure = describeAuthFailure(error, 'sign-up');
      if (nextFailure.field === 'password') {
        setPasswordError(nextFailure.message);
      } else if (nextFailure.field === 'email' && !nextFailure.offerSignIn) {
        setEmailError(nextFailure.message);
      } else {
        setFailure(nextFailure);
      }
      setPhase('idle');
    }
  }

  // The message and its recovery link sit in the same node, so the field error announces both.
  const emailMessage: ReactNode =
    takenFailure === null ? (
      emailError
    ) : (
      <span>
        {takenFailure.message}{' '}
        <Link className="underline" href={signInHref}>
          Sign in instead
        </Link>
      </span>
    );

  return (
    <AuthCard
      description="Join as an owner or researcher. Choose your role after sign up."
      title="Create your account"
    >
      {unavailable ? <Callout variant="danger">{auth.error}</Callout> : null}

      <AuthOauthAction />
      <AuthEmailDivider />

      <form className="flex w-full flex-col gap-2xl" noValidate onSubmit={(e) => void submit(e)}>
        {failure === null || takenFailure !== null ? null : (
          <AuthAlert failure={failure} signInHref={signInHref} />
        )}

        <Field error={emailMessage} label="Email address">
          <Input
            autoComplete="email"
            name="email"
            onChange={(event) => {
              setEmail(event.target.value);
              setEmailError(null);
              if (takenFailure !== null) setFailure(null);
            }}
            placeholder="you@company.com"
            ref={emailRef}
            required
            size="lg"
            type="email"
            value={email}
          />
        </Field>

        <Field
          error={passwordError}
          helperText="Use 8+ characters with at least one number."
          label="Password"
        >
          <Input
            autoComplete="new-password"
            name="password"
            onChange={(event) => {
              setPassword(event.target.value);
              setPasswordError(null);
            }}
            placeholder="Create a strong password"
            ref={passwordRef}
            required
            size="lg"
            type="password"
            value={password}
          />
        </Field>

        <CheckboxField
          checked={acceptedTerms}
          error={termsError}
          label="I agree to the Terms and Privacy Policy"
          name="terms"
          onCheckedChange={(checked) => {
            setAcceptedTerms(checked === true);
            setTermsError(null);
          }}
          ref={termsRef}
        />

        <Button
          className="w-full"
          disabled={unavailable || auth.loading}
          loading={busy}
          loadingLabel="Creating account"
          size="lg"
          type="submit"
        >
          Create account
        </Button>
      </form>

      <AuthSwitch href={signInHref} label="Sign in" prompt="Already have an account?" />
      <AuthLiveStatus message={PHASE_ANNOUNCEMENT[phase]} />
    </AuthCard>
  );
}
