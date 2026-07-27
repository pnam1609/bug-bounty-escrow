import { IDS, expect, test } from './fixtures';

/*
 * Registration, onboarding, sign in and the guard around protected routes.
 *
 * `returnTo` is sanitised by `safeReturnPath`: anything that is not a same-origin path is dropped
 * and the user goes to their role landing instead. Both halves are asserted, because a test that
 * only proves the cross-origin case would still pass if `returnTo` were ignored entirely.
 */

test('QA-E2E-003 registration requires the terms, then onboarding lands the chosen role', async ({
  anonymousPage: page,
  api,
}) => {
  api.setProfile({
    role: 'researcher',
    displayName: 'Pending setup',
    onboardingComplete: false,
    id: IDS.newcomer,
    email: 'new@local.demo',
  });

  await page.goto('/register');
  await page.getByLabel('Email address').fill('new@local.demo');
  await page.getByLabel('Password').fill('safe-password-1');

  // The Terms checkbox now gates the submit: without it the account is never created.
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByText('Accept the Terms and Privacy Policy to continue.')).toBeVisible();
  await expect(page).toHaveURL(/\/register/);

  await page.getByRole('checkbox', { name: 'I agree to the Terms and Privacy Policy' }).check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await expect(page.getByRole('heading', { name: 'How will you participate?' })).toBeVisible();
  await page.getByRole('button', { name: 'Get started' }).click();

  // Account type
  await expect(page.getByRole('heading', { name: 'Choose your account type' })).toBeVisible();
  await page.getByRole('radio', { name: /Program owner/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Display name
  await expect(page.getByRole('heading', { name: 'Set up your owner profile' })).toBeVisible();
  await page.getByLabel('Display name').fill('Ada Owner');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Confirm
  await expect(page.getByRole('heading', { name: 'Confirm your setup' })).toBeVisible();
  await expect(page.getByText('Ada Owner')).toBeVisible();
  await page.getByRole('button', { name: 'Complete setup' }).click();

  // The server's answer decides the landing route, not the local selection.
  await expect(page).toHaveURL(/\/owner\/programs$/);
  expect(api.lastBody('PATCH', '/api/me/onboarding')).toEqual({
    role: 'owner',
    displayName: 'Ada Owner',
  });
});

test('QA-E2E-004 sign in ignores a cross-origin returnTo and uses the role landing', async ({
  anonymousPage: page,
}) => {
  await page.goto('/login?returnTo=https%3A%2F%2Fevil.example%2Fsteal');
  await page.getByLabel('Email address').fill('researcher@local.demo');
  await page.getByLabel('Password').fill('safe-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/programs$/);
  expect(page.url()).not.toContain('evil.example');
});

test('QA-E2E-004 sign in honours a safe same-origin returnTo', async ({ anonymousPage: page }) => {
  await page.goto('/login?returnTo=%2Freports');
  await page.getByLabel('Email address').fill('researcher@local.demo');
  await page.getByLabel('Password').fill('safe-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/reports$/);
  await expect(page.getByRole('heading', { level: 1, name: 'My reports' })).toBeVisible();
});

test('ACC-04 keyboard account-menu logout ignores a dirty profile and replaces with sign in', async ({
  researcherPage: page,
}) => {
  await page.goto('/account/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible();
  await page.getByLabel('Display name').fill('Unsaved researcher name');

  const trigger = page.getByRole('button', { name: 'Open account menu' });
  await trigger.focus();
  await page.keyboard.press('Enter');

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Account settings' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Log out' })).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
});

test('QA-E2E-010 a researcher deep link into the owner workspace lands on the forbidden state', async ({
  researcherPage: page,
  api,
}) => {
  await page.goto('/owner/programs');

  // Scoped by text because Next's own route announcer is a second empty `role="alert"`.
  // ACCESS-01 verbatim copy: the heading plus the role the *area* requires (CP-09).
  const forbidden = page.getByRole('alert').filter({ hasText: 'This workspace isn’t available' });
  await expect(forbidden).toBeVisible();
  await expect(forbidden).toContainText('Your account does not have Program owner access.');
  // The guard renders in place rather than redirecting, so the URL is unchanged.
  await expect(page).toHaveURL(/\/owner\/programs$/);

  // Nothing protected was ever painted: the owner list never mounted, so it never fetched.
  expect(api.calls('GET', '/api/owner/programs')).toHaveLength(0);
  await expect(page.getByRole('link', { name: 'Create program' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1, name: 'Programs' })).toHaveCount(0);
});

test('QA-E2E-010 a reviewer deep link into researcher reports lands on the forbidden state', async ({
  reviewerPage: page,
  api,
}) => {
  await page.goto('/reports');

  // SR-12 verbatim: the reports area requires the Security researcher role.
  const forbidden = page.getByRole('alert').filter({ hasText: 'This workspace isn’t available' });
  await expect(forbidden).toBeVisible();
  await expect(forbidden).toContainText('Your account does not have Security researcher access.');
  expect(api.calls('GET', '/api/reports')).toHaveLength(0);
  await expect(page.getByRole('heading', { level: 1, name: 'My reports' })).toHaveCount(0);
});

// ACC-02 · `/account/settings`. The sample identity is the one the flow doc fixes (§3.1).
test('account settings saves the display name and leaves role and email server-owned', async ({
  researcherPage: page,
  api,
}) => {
  api.setProfile({
    role: 'researcher',
    displayName: 'John Delph',
    onboardingComplete: true,
    email: 'john.delph@example.com',
  });

  await page.goto('/account/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Account settings' })).toBeVisible();
  await expect(
    page.getByText('Manage how your profile appears across BountyEscrow.'),
  ).toBeVisible();

  const save = page.getByRole('button', { name: 'Save changes' });
  const cancel = page.getByRole('button', { name: 'Cancel' });
  const displayName = page.getByLabel('Display name');

  // Nothing changed yet, so there is nothing to send.
  await expect(save).toBeDisabled();

  // §3.2: the immutable account-type note is on screen, verbatim and unlinked.
  await expect(
    page.getByText(
      'Account type cannot be changed from settings in the MVP. Contact support if your account was set up incorrectly.',
    ),
  ).toBeVisible();

  // The client rule is asserted before the request: an empty name must never reach the API.
  await displayName.fill('   ');
  await expect(page.getByText('Display name is required.')).toBeVisible();
  await expect(save).toBeDisabled();

  // §9: Cancel restores the latest server profile and sends nothing.
  await cancel.click();
  await expect(displayName).toHaveValue('John Delph');
  await expect(save).toBeDisabled();
  expect(api.calls('PATCH', '/api/me')).toHaveLength(0);

  await displayName.fill('Delph Researcher');
  await save.click();

  await expect(page.getByText('Profile changes saved')).toBeVisible();
  expect(api.lastBody('PATCH', '/api/me')).toEqual({ displayName: 'Delph Researcher' });
  // Saving re-seeds the shared `me` query, so the header identity moves with it.
  await expect(page.getByRole('banner').getByText('Delph Researcher')).toBeVisible();
  await expect(save).toBeDisabled();

  // §3.1/§3.2: none of these is editable, and no request may carry them.
  await expect(page.getByLabel('Email')).toHaveAttribute('readonly', '');
  await expect(page.getByLabel('Email')).toHaveValue('john.delph@example.com');
  await expect(page.getByRole('combobox', { name: /account type/i })).toHaveCount(0);
  expect(api.lastBody('PATCH', '/api/me')).not.toHaveProperty('role');

  // §8: the account/security rail and the help card, with no invented security controls.
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Need help with your account?' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Contact support' })).toBeVisible();
  // §3.4: no wallet anywhere in account settings.
  await expect(page.getByText(/wallet/i)).toHaveCount(0);
});

test('QA-E2E-010 an anonymous deep link into a guarded route goes to sign in with a safe returnTo', async ({
  anonymousPage: page,
}) => {
  await page.goto(`/review/${IDS.report}`);

  await expect(page).toHaveURL(/\/login\?returnTo=%2Freview%2F/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});
