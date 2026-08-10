import { AEGIS_SUMMARY, IDS, expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/*
 * The five-step Submit Bug composer: Assets & Impact -> Severity -> Main Report -> Reward Wallet -> Review.
 *
 * The navigation buttons are never disabled; a step refuses to advance by keeping its heading on
 * screen and showing an error. Both are asserted, because a `disabled` assertion would silently
 * pass if the button simply stopped existing.
 */

const PROOF = {
  name: 'proof.txt',
  mimeType: 'text/plain',
  buffer: Buffer.from('demo proof'),
};

async function chooseAssetAndImpact(page: Page): Promise<void> {
  await expect(
    page.getByRole('heading', { name: 'Choose the affected asset and impact' }),
  ).toBeVisible();
  await page.getByRole('radio', { name: /Aegis Core Contract/ }).check();
  await page.getByRole('checkbox', { name: /Direct theft of user funds/ }).check();
  await page.getByRole('button', { name: 'Continue to severity' }).click();
}

async function writeReport(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Write the vulnerability report' })).toBeVisible();
  await page.getByLabel('Report title').fill('Re-entrancy can drain the staking pool');
  await page
    .locator('#description')
    .fill('The vault withdraw path re-enters before the balance is written back.');
  await page
    .locator('#reproductionSteps')
    .fill('1. Deposit\n2. Re-enter withdraw from a malicious receiver\n3. Observe the drain');
}

async function selectRewardWallet(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Continue to reward wallet' }).click();
  await expect(page.getByRole('heading', { name: 'Select your reward wallet' })).toBeVisible();
  await page.getByRole('radio', { name: /Research wallet/ }).check();
  await page.getByRole('button', { name: 'Review report' }).click();
}

test('QA-E2E-005 the composer walks five steps and blocks a severity mismatch until acknowledged', async ({
  researcherPage: page,
  api,
}) => {
  await page.goto(`/reports/new?programSlug=${AEGIS_SUMMARY.slug}`);

  await chooseAssetAndImpact(page);

  // ------------------------------------------------------------ severity mismatch
  // The only selected impact is Critical, so proposing Low is a mismatch.
  await expect(page.getByRole('heading', { name: 'Choose your proposed severity' })).toBeVisible();
  await page.getByRole('radio', { name: /^Low/ }).check();
  await page.getByRole('button', { name: 'Continue to main report' }).click();

  await expect(page.getByText('Your severity differs from the selected impacts')).toBeVisible();
  await expect(
    page.getByText('Confirm the severity mismatch or update your selection.'),
  ).toBeVisible();
  // Still on Severity: the step did not advance.
  await expect(page.getByRole('heading', { name: 'Choose your proposed severity' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Write the vulnerability report' })).toHaveCount(
    0,
  );

  await page.getByRole('checkbox', { name: /I reviewed the mismatch/ }).check();
  await page.getByRole('button', { name: 'Continue to main report' }).click();

  // ------------------------------------------------------------ main report
  await writeReport(page);
  await selectRewardWallet(page);

  // ------------------------------------------------------------ review and submit
  await expect(page.getByRole('heading', { name: 'Review your private report' })).toBeVisible();
  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).check();
  await page.getByRole('button', { name: 'Submit private report' }).click();

  await expect(page).toHaveURL(new RegExp(`/reports/${IDS.report}$`));

  const created = api.lastBody('POST', `/api/programs/${IDS.aegis}/reports`);
  expect(created).toMatchObject({
    affectedScopeId: IDS.aegisScope,
    programImpactIds: [IDS.aegisImpactCritical],
    customImpacts: [],
    title: 'Re-entrancy can drain the staking pool',
    proposedSeverity: 'low',
    severityMismatchAcknowledged: true,
    payoutWalletId: IDS.payoutWallet,
  });
});

test('QA-E2E-006 a failed attachment upload keeps the submitted report and never resubmits it', async ({
  researcherPage: page,
  api,
}) => {
  api.failAttachmentUpload();

  await page.goto(`/reports/new?programSlug=${AEGIS_SUMMARY.slug}`);

  await chooseAssetAndImpact(page);

  // Matching the highest selected impact keeps this test on the attachment path only.
  await page.getByRole('radio', { name: /^Critical/ }).check();
  await page.getByRole('button', { name: 'Continue to main report' }).click();

  await writeReport(page);
  await page.getByLabel('Private attachment (optional)').setInputFiles(PROOF);
  await selectRewardWallet(page);

  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).check();
  await page.getByRole('button', { name: 'Submit private report' }).click();

  // ------------------------------------------------------------ partial success
  await expect(
    page.getByRole('heading', { name: 'The attachment did not finish uploading' }),
  ).toBeVisible();
  await expect(page.getByText('Your report was submitted')).toBeVisible();
  await expect(
    page.getByText('Your report is safe. Retry only the file upload, or continue without it.'),
  ).toBeVisible();

  const createPath = `/api/programs/${IDS.aegis}/reports`;
  expect(api.calls('POST', createPath)).toHaveLength(1);

  // ------------------------------------------------------------ retry uploads only
  await page.getByRole('button', { name: 'Retry attachment' }).click();

  await expect.poll(() => api.calls('POST', '/attachments/upload-url').length).toBeGreaterThan(1);
  await expect(
    page.getByRole('heading', { name: 'The attachment did not finish uploading' }),
  ).toBeVisible();
  expect(api.calls('POST', createPath)).toHaveLength(1);

  // ------------------------------------------------------------ leave without the file
  await page.getByRole('button', { name: 'Continue without attachment' }).click();

  await expect(page).toHaveURL(new RegExp(`/reports/${IDS.report}$`));
  expect(api.calls('POST', createPath)).toHaveLength(1);
});

test('RW-04 RainbowKit exclusively owns interaction while its wallet modal is open', async ({
  researcherPage: page,
}) => {
  await page.goto(`/reports/new?programSlug=${AEGIS_SUMMARY.slug}`);
  await chooseAssetAndImpact(page);
  await page.getByRole('radio', { name: /^Critical/ }).check();
  await page.getByRole('button', { name: 'Continue to main report' }).click();
  await writeReport(page);
  await page.getByRole('button', { name: 'Continue to reward wallet' }).click();
  await page.getByRole('button', { name: 'Add another wallet' }).click();

  const addWalletDialog = page.locator('[data-wallet-dialog-suspended]');
  const connectWalletButton = addWalletDialog.getByRole('button', { name: 'Connect wallet' });
  await expect(addWalletDialog).toHaveAttribute('data-wallet-dialog-suspended', 'false');
  await connectWalletButton.click();

  const rainbowDialog = page.getByRole('dialog', { name: 'Connect a Wallet' });
  await expect(rainbowDialog).toBeVisible();
  await expect(addWalletDialog).toHaveAttribute('data-wallet-dialog-suspended', 'true');
  await expect(addWalletDialog).toHaveAttribute('inert', '');
  await expect(addWalletDialog).toHaveCSS('pointer-events', 'none');
  await expect
    .poll(async () => {
      const addWalletZIndex = Number(
        await addWalletDialog.evaluate((node) => getComputedStyle(node).zIndex),
      );
      const rainbowZIndex = Number(
        await rainbowDialog.evaluate((node) => getComputedStyle(node).zIndex),
      );
      return rainbowZIndex > addWalletZIndex;
    })
    .toBe(true);

  await page.keyboard.press('Escape');
  await expect(rainbowDialog).toBeHidden();
  await expect(addWalletDialog).toHaveAttribute('data-wallet-dialog-suspended', 'false');
  await expect(connectWalletButton).toBeFocused();
});
