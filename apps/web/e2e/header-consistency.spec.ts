import type { Page } from '@playwright/test';

import { AEGIS_SUMMARY, expect, test } from './fixtures';

const MARKETING_NAV = [
  { href: '/programs', label: 'Programs' },
  { href: '/#how-escrow-works', label: 'How it works' },
  { href: '/#live-escrow', label: 'Escrow' },
  { href: '/#why-bountyescrow', label: 'Security' },
] as const;

async function expectNoMarketingNav(page: Page, allowWorkspacePrograms = false) {
  const header = page.locator('header');
  const links = allowWorkspacePrograms ? MARKETING_NAV.slice(1) : MARKETING_NAV;
  for (const item of links) {
    await expect(header.getByRole('link', { name: item.label, exact: true })).toHaveCount(0);
  }
}

test('anonymous landing keeps marketing navigation and anonymous CTAs', async ({
  anonymousPage: page,
}) => {
  await page.goto('/');

  const header = page.locator('header');
  for (const item of MARKETING_NAV) {
    await expect(header.getByRole('link', { name: item.label, exact: true })).toHaveAttribute(
      'href',
      item.href,
    );
  }
  await expect(header.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Launch app', exact: true })).toBeVisible();
});

test('authenticated landing resolves to account and role workspace actions without Sign in', async ({
  researcherPage: page,
}) => {
  await page.goto('/');

  const header = page.locator('header');
  await expect(header.getByRole('button', { name: 'Open account menu' })).toBeVisible();
  await expect(header.getByRole('link', { name: 'Open workspace', exact: true })).toHaveAttribute(
    'href',
    '/programs',
  );
  await expect(header.getByRole('link', { name: 'Sign in', exact: true })).toHaveCount(0);
  await expect(header.getByRole('link', { name: 'Launch app', exact: true })).toHaveCount(0);
});

test('program list and detail stay on the app header without marketing navigation', async ({
  anonymousPage: page,
}) => {
  await page.goto('/programs');
  await expect(page.getByRole('heading', { level: 1, name: 'Find your next bounty' })).toBeVisible();
  await expectNoMarketingNav(page);

  await page.goto(`/programs/${AEGIS_SUMMARY.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: AEGIS_SUMMARY.name })).toBeVisible();
  await expectNoMarketingNav(page);
});

test('auth and protected workspace routes do not inherit landing marketing navigation', async ({
  ownerPage: page,
}) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('header')).toHaveCount(0);

  await page.goto('/owner/programs');
  await expect(page.getByRole('heading', { level: 1, name: 'Programs' })).toBeVisible();
  await expectNoMarketingNav(page, true);
});
