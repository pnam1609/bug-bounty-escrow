import { AEGIS_SUMMARY, IDS, expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/*
 * The four-step Submit Bug composer: Assets & Impact -> Severity -> Main Report -> Review.
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
  await expect(page.getByRole('heading', { name: '1. Choose an asset' })).toBeVisible();
  await page.getByRole('radio', { name: /Aegis Core Contract/ }).check();
  await page.getByRole('checkbox', { name: /Direct theft of user funds/ }).check();
  await page.getByRole('button', { name: 'Continue to severity' }).click();
}

async function writeReport(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Write the vulnerability report' })).toBeVisible();
  await page.getByLabel('Report title').fill('Re-entrancy can drain the staking pool');
  await page
    .getByLabel('Vulnerability description')
    .fill('The vault withdraw path re-enters before the balance is written back.');
  await page
    .getByLabel('Reproduction steps / PoC')
    .fill('1. Deposit\n2. Re-enter withdraw from a malicious receiver\n3. Observe the drain');
}

test('QA-E2E-005 the composer walks four steps and blocks a severity mismatch until acknowledged', async ({
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
  await page.getByRole('button', { name: 'Review report' }).click();

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
  await page.getByRole('button', { name: 'Review report' }).click();

  await page.getByRole('checkbox', { name: /I confirm this report is accurate/ }).check();
  await page.getByRole('button', { name: 'Submit private report' }).click();

  // ------------------------------------------------------------ partial success
  await expect(
    page.getByRole('heading', { name: 'The attachment did not finish uploading' }),
  ).toBeVisible();
  await expect(page.getByText('Your report was submitted')).toBeVisible();
  await expect(page.getByText('Your report is safe. Retry only the file upload, or continue without it.')).toBeVisible();

  const createPath = `/api/programs/${IDS.aegis}/reports`;
  expect(api.calls('POST', createPath)).toHaveLength(1);

  // ------------------------------------------------------------ retry uploads only
  await page.getByRole('button', { name: 'Retry attachment' }).click();

  await expect
    .poll(() => api.calls('POST', '/attachments/upload-url').length)
    .toBeGreaterThan(1);
  await expect(
    page.getByRole('heading', { name: 'The attachment did not finish uploading' }),
  ).toBeVisible();
  expect(api.calls('POST', createPath)).toHaveLength(1);

  // ------------------------------------------------------------ leave without the file
  await page.getByRole('button', { name: 'Continue without attachment' }).click();

  await expect(page).toHaveURL(new RegExp(`/reports/${IDS.report}$`));
  expect(api.calls('POST', createPath)).toHaveLength(1);
});
