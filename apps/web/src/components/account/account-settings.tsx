'use client';

import { updateProfileResponseSchema, type CurrentUser } from '@bug-bounty-escrow/shared';
import {
  Button,
  Callout,
  Card,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  Input,
  SiteBrand,
  SiteFooter,
  SiteHeader,
} from '@bug-bounty-escrow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { LogoutMenuItem, useLogoutAction } from './logout-action';
import {
  ACCOUNT_SETTINGS_COPY as COPY,
  ACCOUNT_SETTINGS_PATH,
  DISPLAY_NAME_MAX_LENGTH,
  PROGRAMS_PATH,
  SAVED_MESSAGE_DURATION_MS,
  avatarInitials,
  describeLoadFailure,
  describeProfileForm,
  describeSaveFailure,
} from './account-settings-model';
import { withReturnTo } from '@/components/auth/use-auth-redirect';
import {
  ROLE_LABELS,
  ROLE_LANDING_PATHS,
  SUPPORT_HREF,
} from '@/components/onboarding/role-options';
import { ResearcherHeader } from '@/components/programs/researcher-shell';
import { useCurrentUser } from '@/hooks/use-current-user';
import { apiRequest, safeReturnPath } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

/*
 * ACC-00 … ACC-06 · Account settings (Figma 282:1949, saved 285:4400, validation 285:4475, mobile
 * 282:1952).
 *
 * docs/flow/account-settings-researcher-flow-for-figma.md is the source of truth. Three rules from
 * it shape everything below:
 *
 *  - §3.1/§3.2: `Display name` is the only editable field. Role and email are server-owned, so
 *    there is no role dropdown, no workspace switcher, no reviewer self-assignment and no wallet.
 *    `PATCH /api/me` carries exactly `{ displayName }`, which the strict contract schema enforces.
 *  - §9: the form baseline is the *latest* profile response, never a value captured once at mount.
 *    The draft is held as `null` until the user types, so Cancel is a reset to the server truth.
 *  - §8 ACC-00/§4.10: nothing editable, and no name at all, paints before the session and profile
 *    are confirmed — the skeleton below stands in, inside a header that carries no identity.
 *
 * Session, onboarding and role are settled by the shared `RoleGuard` on the route; the loading and
 * load-failure surfaces it shows for *this* route are `AccountSettingsLoading` and
 * `AccountLoadFailure`, handed to it from `app/account/settings/page.tsx`.
 */

/**
 * §8 ACC-06 + "returnTo chỉ dùng internal path `/account/settings`". Built from the two sanctioned
 * helpers rather than by hand: `safeReturnPath` is the single rule for what may be returned to, and
 * `withReturnTo` the single rule for how it rides on the query string. The value is this route's
 * own constant and nothing else, so no draft display name can ever reach the URL.
 */
const SIGN_IN_HREF = withReturnTo('/login', safeReturnPath(ACCOUNT_SETTINGS_PATH));

/* ── Shell ──────────────────────────────────────────────────────────────────────────────── */

/**
 * §5.1/§5.3: the website header with no sidebar, and a `1104px` content column centred beneath it.
 * Researchers reuse the BT-09 header/menu directly. The route also admits owner/reviewer accounts,
 * whose workspace destinations remain role-specific while sharing the same logout action.
 *
 * §8 ACC-00: with no confirmed profile the header is the safe shell — brand and footer only. No
 * initials, no name and no role-specific destination, so a previous visitor's identity can never be
 * on screen while the current one is still being resolved.
 */
function AccountShell({
  children,
  user,
}: {
  readonly children: ReactNode;
  readonly user?: CurrentUser | undefined;
}) {
  const header =
    user?.role === 'researcher' ? (
      <ResearcherHeader />
    ) : (
      <SiteHeader
        actions={user === undefined ? null : <WorkspaceAccountMenu user={user} />}
        brand={
          <Link
            className="rounded-md"
            href={user === undefined ? PROGRAMS_PATH : ROLE_LANDING_PATHS[user.role]}
          >
            <SiteBrand />
          </Link>
        }
      />
    );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {header}
      <main className="flex-1">
        <div className="mx-auto w-full max-w-[1104px] px-lg py-2xl md:px-2xl lg:px-[64px]">
          {children}
        </div>
      </main>
      <SiteFooter copyright="© 2026 BountyEscrow" variant="short" />
    </div>
  );
}

/**
 * §5.2. Identity summary, the viewer's own destinations, a separator, then `Log out`. Radix
 * supplies `aria-haspopup`, the expanded state, arrow-key roving and Escape, so none of that is
 * re-implemented here. No role switcher: role is a backend decision (§3.2).
 */
function WorkspaceAccountMenu({ user }: { readonly user: CurrentUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex min-h-11 items-center gap-md rounded-full px-sm text-body-sm text-text"
          type="button"
        >
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-label-md text-text"
          >
            {avatarInitials(user.displayName)}
          </span>
          <span className="hidden sm:inline">{user.displayName}</span>
          <ChevronDown aria-hidden="true" className="size-4 text-text-muted" />
          <span className="sr-only">Open account menu</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56">
        <DropdownMenuLabel>
          <span className="block text-body-sm text-text">{user.displayName}</span>
          <span className="block text-label-sm text-text-muted">{ROLE_LABELS[user.role]}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={ROLE_LANDING_PATHS[user.role]}>
            {user.role === 'reviewer' ? 'Review inbox' : 'Browse programs'}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          {/* §5.2: the current destination carries the selected treatment. */}
          <Link aria-current="page" className="bg-ambient text-text" href={ACCOUNT_SETTINGS_PATH}>
            {COPY.title}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <LogoutMenuItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ── ACC-00 · Loading profile ────────────────────────────────────────────────────────────── */

/** One pulsing placeholder bar. Purely decorative — the whole skeleton is `aria-hidden`. */
function SkeletonBar({ className }: { readonly className: string }) {
  return (
    <div className={`rounded-full bg-surface-raised motion-safe:animate-pulse ${className}`} />
  );
}

/**
 * ACC-00 · Loading profile. §8: "Main content dùng skeleton cho title, profile card và side rail"
 * and "Không dùng spinner toàn màn hình nếu skeleton giữ layout ổn định" — so this is the real
 * two-column grid at its real widths, with placeholders where the title, the profile card and the
 * side rail will land. Nothing editable exists yet (§8 ACC-00, §4.10), and the header is the
 * identity-free shell.
 *
 * The skeleton is `aria-hidden`; the single `role="status"` line beneath it is what assistive tech
 * hears, so a screen reader gets one sentence instead of a dozen empty boxes.
 */
export function AccountSettingsLoading() {
  return (
    <AccountShell>
      <div className="flex flex-col gap-2xl">
        <div aria-hidden="true" className="flex flex-col gap-2xl">
          <div className="flex flex-col gap-sm">
            <SkeletonBar className="h-8 w-64 max-w-full rounded-md" />
            <SkeletonBar className="h-4 w-[28rem] max-w-full" />
          </div>

          <div className="grid grid-cols-1 items-start gap-xl lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card padding="lg" className="min-w-0 gap-xl">
              <SkeletonBar className="h-5 w-40 rounded-md" />
              {/* Display name, Email, Account type: label, control, helper. */}
              {[0, 1, 2].map((row) => (
                <div className="flex flex-col gap-sm" key={row}>
                  <SkeletonBar className="h-3 w-28" />
                  <SkeletonBar className="h-12 w-full rounded-md" />
                  <SkeletonBar className="h-3 w-56 max-w-full" />
                </div>
              ))}
              <div className="flex justify-end gap-md">
                <SkeletonBar className="h-12 w-24" />
                <SkeletonBar className="h-12 w-36" />
              </div>
            </Card>

            <div className="flex min-w-0 flex-col gap-xl">
              <Card padding="lg" className="min-w-0">
                <SkeletonBar className="h-5 w-40 rounded-md" />
                <div className="flex items-center gap-md">
                  <SkeletonBar className="size-11 shrink-0" />
                  <div className="flex min-w-0 flex-1 flex-col gap-xs">
                    <SkeletonBar className="h-4 w-32" />
                    <SkeletonBar className="h-3 w-24" />
                  </div>
                </div>
                <SkeletonBar className="h-12 w-full" />
              </Card>
              <Card padding="lg" className="min-w-0">
                <SkeletonBar className="h-5 w-52 max-w-full rounded-md" />
                <SkeletonBar className="h-12 w-full" />
              </Card>
            </div>
          </div>
        </div>

        <p className="text-center text-body-sm text-text-muted" role="status">
          {COPY.loading}
        </p>
      </div>
    </AccountShell>
  );
}

/* ── ACC-05 · Load error and ACC-06 · Session expired ────────────────────────────────────── */

/**
 * The full-page recovery surface both states share: one announced callout and one action row,
 * inside the identity-free shell so no profile — least of all a previous visitor's — is on screen
 * (§8 ACC-05 "Không hiển thị stale profile của user khác").
 *
 * Focus moves to the heading because this card replaces a skeleton the reader was already waiting
 * on: a silent swap in the middle of the page is invisible to anyone not looking at it. Same rule
 * as the onboarding recovery frames.
 */
function AccountRecoveryCard({
  actions,
  message,
  variant,
}: {
  readonly actions: ReactNode;
  readonly message: string;
  readonly variant: 'danger' | 'warning';
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <AccountShell>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-xl py-2xl">
        {/* The page still names itself: the recovery state replaces the content, not the route. */}
        <h1 className="text-h2 text-text" ref={headingRef} tabIndex={-1}>
          {COPY.title}
        </h1>
        {/* Icon plus sentence plus role — never colour alone (§11). */}
        <Callout role="alert" variant={variant}>
          {message}
        </Callout>
        <div className="flex flex-wrap items-center gap-md">{actions}</div>
      </div>
    </AccountShell>
  );
}

/**
 * ACC-05 · Load error and ACC-06 · Session expired, chosen from the reason `GET /api/me` failed.
 *
 * Rendered by `RoleGuard` in place of its own generic profile-error surface, so it reads the same
 * `me` query the guard just judged — same key, same cache entry, no second request.
 *
 * A dead session gets a sign-in and no retry button: retrying is the one thing that cannot work,
 * and offering it invites the loop §8 forbids.
 */
export function AccountLoadFailure() {
  const user = useCurrentUser();

  if (describeLoadFailure(user.error) === 'session-expired') {
    return (
      <AccountRecoveryCard
        message={COPY.sessionExpired}
        variant="warning"
        actions={
          <Button asChild size="lg">
            <Link href={SIGN_IN_HREF}>{COPY.signIn}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <AccountRecoveryCard
      message={COPY.loadError}
      variant="danger"
      actions={
        <>
          <Button
            loading={user.isFetching}
            loadingLabel={COPY.loading}
            onClick={() => void user.refetch()}
            size="lg"
          >
            {COPY.tryAgain}
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href={PROGRAMS_PATH}>{COPY.backToPrograms}</Link>
          </Button>
        </>
      }
    />
  );
}

/* ── Page ───────────────────────────────────────────────────────────────────────────────── */

export function AccountSettings() {
  const user = useCurrentUser();

  // `RoleGuard` already withheld the route until the profile resolved; this is the type narrowing
  // that goes with it, never a second loading policy — hence the same ACC-00 surface rather than a
  // second one that could drift from it.
  if (user.data === undefined) return <AccountSettingsLoading />;

  return (
    <AccountShell user={user.data}>
      <div className="flex flex-col gap-2xl">
        <div className="flex flex-col gap-sm">
          <h1 className="text-h1 text-text">{COPY.title}</h1>
          <p className="text-body text-text-muted">{COPY.supporting}</p>
        </div>

        {/*
         * §5.3: 720px form beside a 360px rail, separated by 24px — 720 + 24 + 360 = the 1104px
         * column. Below `lg` the two stack, and every child is `min-w-0` so a long email or a
         * wrapping helper widens nothing and the page never scrolls sideways (§11).
         */}
        <div className="grid grid-cols-1 items-start gap-xl lg:grid-cols-[minmax(0,1fr)_360px]">
          <ProfileInformationCard user={user.data} />
          <div className="flex min-w-0 flex-col gap-xl">
            <AccountSecurityCard user={user.data} />
            <NeedHelpCard />
          </div>
        </div>
      </div>
    </AccountShell>
  );
}

/* ── Profile information ────────────────────────────────────────────────────────────────── */

function ProfileInformationCard({ user }: { readonly user: CurrentUser }) {
  const displayNameId = useId();
  const emailId = useId();
  const statusId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const { session } = useAuth();
  const client = useQueryClient();

  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async (displayName: string) =>
      (
        await apiRequest('/api/me', updateProfileResponseSchema, {
          method: 'PATCH',
          token: session?.access_token,
          body: { displayName },
        })
      ).data,
    onSuccess: (updated) => {
      /*
       * §9: the response replaces the cached profile, and the form baseline follows it. Seeding the
       * cache rather than only invalidating is what keeps the header, the account menu and the
       * security card from showing the old name for a refetch round trip. The invalidate still runs
       * so the server reconciles the entry afterwards. Nothing is optimistic — this only happens
       * once the PATCH has returned (§4.5).
       */
      const principalId = session?.user.id ?? updated.id;
      client.setQueryData(queryKeys.me(principalId), updated);
      void client.invalidateQueries({ queryKey: queryKeys.me(principalId) });
      setDraft(null);
      setSaved(true);
    },
  });

  /*
   * §8 ACC-02: "tự đóng sau thời gian hợp lý". Without this the confirmation is a flag with no way
   * out — after a save the row is clean, so both buttons are disabled and the only thing that could
   * clear it is typing a *new* edit. It would then still be on screen minutes later, describing a
   * save the reader has long since forgotten.
   */
  useEffect(() => {
    if (!saved) return undefined;
    const timer = window.setTimeout(() => {
      setSaved(false);
    }, SAVED_MESSAGE_DURATION_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [saved]);

  const form = describeProfileForm({
    draft,
    isPending: save.isPending,
    serverDisplayName: user.displayName,
  });

  /*
   * §8 ACC-04/ACC-06. `displayNameToSend` is the trimmed value the failed request carried: the
   * draft cannot have moved since, because any edit resets the mutation below.
   */
  const failure =
    save.error === null ? null : describeSaveFailure(save.error, form.displayNameToSend);
  const isExpired = failure?.kind === 'session-expired';
  // §8 ACC-03 first: what the client already knows outranks what the server said about a value the
  // user has since been told is wrong.
  const serverFieldError = failure?.kind === 'field' ? failure.message : null;
  const fieldError = form.error ?? serverFieldError;
  const alertMessage = failure?.kind === 'page' ? failure.message : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // §9 "Disable double submit". The button is disabled while pending as well; this is the guard
    // for the paths a disabled button does not cover, such as implicit submission.
    if (save.isPending) return;
    // §8 ACC-06: a session already known to be dead is never resent. The row offers `Sign in`
    // instead of a submit button, and Enter in the field must not sneak past that.
    if (isExpired) return;

    if (form.error !== null || !form.isDirty) {
      /*
       * §8 ACC-03: "Focus chuyển tới Display name khi submit invalid." The message is already
       * rendered beside the field — moving focus is what makes an invalid submit land somewhere a
       * keyboard or screen-reader user can act on, instead of failing silently.
       */
      inputRef.current?.focus();
      return;
    }

    setSaved(false);
    save.mutate(form.displayNameToSend);
  }

  /** §9: back to the most recent server profile, and deliberately no request. */
  function cancel() {
    setDraft(null);
    setSaved(false);
    if (save.error !== null) save.reset();
  }

  /*
   * §8 ACC-04 again: when the server is the one rejecting the name, the reader's attention has to
   * be taken back to the field it is about — the alert region they were watching has just gone
   * quiet. Keyed on the message so a second identical failure does not steal focus a second time
   * while they are already retyping.
   */
  const focusedServerErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (serverFieldError === null) {
      focusedServerErrorRef.current = null;
      return;
    }
    if (focusedServerErrorRef.current === serverFieldError) return;
    focusedServerErrorRef.current = serverFieldError;
    inputRef.current?.focus();
  }, [serverFieldError]);

  return (
    <Card padding="lg" className="min-w-0 gap-xl">
      <CardHeader>
        <CardTitle>{COPY.profileHeading}</CardTitle>
      </CardHeader>

      <form className="flex min-w-0 flex-col gap-xl" noValidate onSubmit={submit}>
        <Field
          htmlFor={displayNameId}
          label={COPY.displayNameLabel}
          required
          helperText={COPY.displayNameHelper}
          counter={`${form.value.trim().length}/${String(DISPLAY_NAME_MAX_LENGTH)}`}
          error={fieldError}
        >
          <Input
            ref={inputRef}
            size="lg"
            name="displayName"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX_LENGTH}
            value={form.value}
            disabled={save.isPending}
            onChange={(event) => {
              setDraft(event.target.value);
              setSaved(false);
              // The mutation holds its last error until the next call, so without this a failure
              // message would sit under the field while the user retypes the name.
              if (save.error !== null) save.reset();
            }}
          />
        </Field>

        {/*
         * §3.3: `readOnly`, never `disabled`. The value keeps full-strength `--color-text`, stays
         * focusable, selectable and copyable from the keyboard, and is announced as read-only
         * instead of being skipped by assistive tech.
         */}
        <Field htmlFor={emailId} label={COPY.emailLabel} helperText={COPY.emailHelper}>
          <Input size="lg" type="email" value={user.email} readOnly />
        </Field>

        {/* §3.2/§8 field 3: a read-only value row. Not a select, and not a violet pill — brand
            violet is reserved for the primary action (§12). */}
        <div className="flex min-w-0 flex-col gap-sm">
          <dl className="flex flex-col gap-sm">
            <dt className="text-label-md text-text">{COPY.accountTypeLabel}</dt>
            <dd className="flex flex-wrap items-center justify-between gap-md rounded-md border border-border bg-surface-raised px-lg py-md">
              <span className="min-w-0 text-body-sm text-text">{ROLE_LABELS[user.role]}</span>
              <span className="shrink-0 text-label-sm uppercase text-text-muted">Read only</span>
            </dd>
          </dl>
          <Callout variant="info">{COPY.accountTypeImmutable}</Callout>
        </div>

        {/*
         * §8 ACC-04 page-level alert, and §8 ACC-06 in its place when the session is what failed.
         * Both sit above the action row, inside the form, so the typed value stays on screen and
         * untouched — §4.8 keeps the input for the retry.
         */}
        {isExpired ? (
          <Callout role="alert" variant="warning">
            {COPY.sessionExpired}
          </Callout>
        ) : alertMessage === null ? null : (
          <Callout variant="danger">{alertMessage}</Callout>
        )}

        <div className="flex flex-wrap items-center gap-md">
          {/*
           * One polite live region rather than a floating toast: the outcome belongs beside the
           * control that produced it, and swapping the text inside a single `role="status"` is what
           * makes a screen reader announce it (§11). Mint is the success semantic (§12).
           */}
          <p
            aria-live="polite"
            className="mr-auto text-label-md text-escrow"
            id={statusId}
            role="status"
          >
            {saved ? COPY.saved : ''}
          </p>

          {/*
           * §8 ACC-01 idle row: ghost `Cancel` beside primary `Save changes`. §8 ACC-04 swaps it for
           * secondary `Cancel` beside primary `Try again` once a save has failed — same two slots,
           * so the row neither grows a third button nor moves the primary action out from under the
           * pointer. `Cancel` is always enabled while a failure is showing: it is the affordance
           * that clears the alert, and after a failed save the row must never be a dead end.
           */}
          <Button
            disabled={failure === null && (!form.isDirty || save.isPending)}
            onClick={cancel}
            size="lg"
            variant={failure === null ? 'ghost' : 'secondary'}
          >
            {COPY.cancel}
          </Button>

          {/*
           * §11 "Loading và pending buttons giữ width ổn định": the primary slot is floored at one
           * width that fits all three of its labels. `Button` already hides the label in place while
           * loading, but the label itself changes here — `Try again` the moment a save fails, `Save
           * changes` again the moment the retry starts — and without a floor the row would step
           * sideways on every one of those transitions.
           */}
          {isExpired ? (
            /*
             * §8 ACC-06. A retry is deliberately not offered: no number of attempts revives a dead
             * session, and the sign-in carries only this route's own path back (see SIGN_IN_HREF).
             */
            <Button asChild className="min-w-[10rem]" size="lg">
              <Link href={SIGN_IN_HREF}>{COPY.signIn}</Link>
            </Button>
          ) : (
            <Button
              aria-describedby={statusId}
              className="min-w-[10rem]"
              // §8 ACC-01 keeps this disabled when there is nothing to send and while a request is
              // in flight (which is also half of "disable double submit"). It stays operable while
              // the value is *invalid* so that ACC-03's "focus chuyển tới Display name khi submit
              // invalid" is a path the user can actually take — a disabled button swallows the
              // submit event, and with it the error and the focus move. `canSave` still gates the
              // request itself, so nothing invalid is ever sent.
              disabled={!form.isDirty || save.isPending}
              loading={save.isPending}
              loadingLabel={COPY.saving}
              size="lg"
              type="submit"
            >
              {/* §8 ACC-04: `Try again`, and the retry sends the same trimmed value. */}
              {failure === null ? COPY.save : COPY.tryAgain}
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

/* ── Account & security ─────────────────────────────────────────────────────────────────── */

/**
 * §8 "Account & security card": initials, display name, account type and `Log out` — and nothing
 * else. No password, MFA or connected-identity controls: those belong to the auth provider and
 * §3.4 forbids drawing them before an endpoint and a recovery contract exist.
 */
function AccountSecurityCard({ user }: { readonly user: CurrentUser }) {
  const logout = useLogoutAction();

  return (
    <Card padding="lg" className="min-w-0">
      <CardHeader>
        <CardTitle>{COPY.securityHeading}</CardTitle>
      </CardHeader>

      <div className="flex min-w-0 items-center gap-md">
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-surface-raised text-label-lg text-text"
        >
          {avatarInitials(user.displayName)}
        </span>
        <div className="flex min-w-0 flex-col gap-xs">
          <p className="truncate text-body-sm text-text">{user.displayName}</p>
          <p className="text-label-sm text-text-muted">{ROLE_LABELS[user.role]}</p>
        </div>
      </div>

      {/* §8 ACC-08: the failure keeps the reader on the page and offers the same button again. */}
      {logout.error === null || logout.isPending ? null : (
        <p className="text-label-md text-error" role="alert">
          {logout.error}
        </p>
      )}

      {/*
       * §4.11: logout is its own action — outside the profile form, and independent of whether the
       * form is dirty. Disabled while in flight so it cannot be double-fired (ACC-07).
       */}
      <Button
        className="w-full"
        disabled={logout.isPending}
        loading={logout.isPending}
        loadingLabel={COPY.loggingOut}
        onClick={() => {
          void logout.logOut();
        }}
        size="lg"
        variant="ghost"
      >
        {COPY.logOut}
      </Button>
    </Card>
  );
}

/* ── Need help ──────────────────────────────────────────────────────────────────────────── */

/**
 * §8 "Need help card". The destination is the single configured `SUPPORT_HREF` constant, so no
 * unconfirmed mailbox or URL is hard-coded into the screen.
 */
function NeedHelpCard() {
  return (
    <Card padding="lg" className="min-w-0">
      <CardHeader>
        <CardTitle>{COPY.helpHeading}</CardTitle>
      </CardHeader>
      <Button asChild className="w-full" size="lg" variant="ghost">
        <Link href={SUPPORT_HREF}>{COPY.helpAction}</Link>
      </Button>
    </Card>
  );
}
