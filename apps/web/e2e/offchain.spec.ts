import {
  AEGIS_SUMMARY,
  IDS,
  LUMEN_SUMMARY,
  ORBIT_SUMMARY,
  PRIVATE_PROGRAM_NAMES,
  expect,
  test,
} from './fixtures';

/*
 * Public, unauthenticated browsing of the bounty table.
 *
 * The desktop table and the mobile card list are both mounted and toggled with CSS, so text-based
 * locators match twice. Everything here goes through `getByRole`, which skips the hidden copy, or
 * is scoped to the table.
 */

test('QA-E2E-001 the bounty table lists public programs, marks a private payout total, and opens a detail page', async ({
  anonymousPage: page,
  api,
}) => {
  await page.goto('/programs');

  const table = page.getByRole('table');
  const row = (name: string) => table.getByRole('row').filter({ hasText: name });

  await expect(row(AEGIS_SUMMARY.name)).toBeVisible();
  await expect(row(LUMEN_SUMMARY.name)).toBeVisible();
  await expect(row(ORBIT_SUMMARY.name)).toBeVisible();

  // An owner who keeps the payout total private sends `totalPaid: null`, and the table has to say
  // so rather than showing a zero. The sr-only copy is what a screen reader announces.
  await expect(row(LUMEN_SUMMARY.name)).toContainText('Private');
  await expect(row(LUMEN_SUMMARY.name)).toContainText('Total paid is private');
  await expect(row(AEGIS_SUMMARY.name)).toContainText('250,000 USDC paid out so far');

  // A draft or paused program has no public lifecycle at all and must never be discoverable.
  for (const hidden of PRIVATE_PROGRAM_NAMES) {
    await expect(page.getByText(hidden)).toHaveCount(0);
  }

  // The public page must read the public endpoint. Reading the owner listing would leak the rows
  // filtered out above, so assert the browse page never touches it.
  expect(api.calls('GET', '/api/owner/programs')).toHaveLength(0);
  expect(api.calls('GET', '/api/programs').length).toBeGreaterThan(0);

  await table.getByRole('link', { name: `View bounty for ${AEGIS_SUMMARY.name}` }).click();

  await expect(page).toHaveURL(new RegExp(`/programs/${IDS.aegis}$`));
  await expect(page.getByRole('heading', { level: 1, name: AEGIS_SUMMARY.name })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Submit a private report' })).toBeVisible();
});

test('QA-E2E-002 a filter shows a chip, is carried in the URL, survives a reload, and clears', async ({
  anonymousPage: page,
}) => {
  await page.goto('/programs');

  const table = page.getByRole('table');
  const row = (name: string) => table.getByRole('row').filter({ hasText: name });
  await expect(row(AEGIS_SUMMARY.name)).toBeVisible();

  // ---------------------------------------------------------------- apply a filter
  await page.getByRole('button', { name: 'Asset type filter' }).click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('checkbox', { name: 'Website' }).check();
  await panel.getByRole('button', { name: 'Apply' }).click();

  const chip = page.getByRole('button', { name: 'Remove Website filter' });
  await expect(chip).toBeVisible();
  await expect(page).toHaveURL(/[?&]assetType=website(&|$)/);
  await expect(row(LUMEN_SUMMARY.name)).toBeVisible();
  await expect(row(AEGIS_SUMMARY.name)).toHaveCount(0);

  // ---------------------------------------------------------------- a reload restores it
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove Website filter' })).toBeVisible();
  await expect(row(LUMEN_SUMMARY.name)).toBeVisible();
  await expect(row(AEGIS_SUMMARY.name)).toHaveCount(0);

  // ---------------------------------------------------------------- clear all
  await page.getByRole('button', { name: 'Clear all' }).click();
  await expect(page.getByRole('button', { name: 'Remove Website filter' })).toHaveCount(0);
  await expect(page).not.toHaveURL(/assetType/);
  await expect(row(AEGIS_SUMMARY.name)).toBeVisible();
});

test('QA-E2E-002 sorting by a column is reflected in the URL, the header state, and the row order', async ({
  anonymousPage: page,
}) => {
  await page.goto('/programs');

  const table = page.getByRole('table');
  await expect(table.getByRole('row').filter({ hasText: AEGIS_SUMMARY.name })).toBeVisible();

  const header = page.getByRole('columnheader', { name: 'Max bounty' });
  await expect(header).toHaveAttribute('aria-sort', 'none');

  await header.getByRole('button', { name: 'Max bounty' }).click();

  await expect(page).toHaveURL(/sort=maxBounty/);
  await expect(page).toHaveURL(/sortDirection=asc/);
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  // Row 0 is the header row; the cheapest program leads an ascending sort.
  await expect(table.getByRole('row').nth(1)).toContainText(ORBIT_SUMMARY.name);

  await page.reload();
  await expect(page.getByRole('columnheader', { name: 'Max bounty' })).toHaveAttribute(
    'aria-sort',
    'ascending',
  );
  await expect(table.getByRole('row').nth(1)).toContainText(ORBIT_SUMMARY.name);
});
