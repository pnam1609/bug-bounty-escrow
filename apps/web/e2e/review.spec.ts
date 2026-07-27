import { IDS, expect, test } from './fixtures';
import type { Locator } from '@playwright/test';

/*
 * Reviewer decisions.
 *
 * Every transition is confirmed in a Radix AlertDialog. A `page.on('dialog')` handler no longer
 * has anything to accept, so each test counts native dialogs and asserts that none appeared —
 * otherwise a regression back to `window.confirm` would still let the suite pass.
 */

interface TransitionCase {
  readonly trigger: string;
  readonly title: string;
  readonly confirm: string;
  readonly fill?: (dialog: Locator) => Promise<void>;
  /** The plain-language state line the report shows once the decision lands. */
  readonly summary: string;
  /** What the decision panel offers next, proving the state machine really moved. */
  readonly next: string;
}

const TRANSITIONS: readonly TransitionCase[] = [
  {
    trigger: 'Request information',
    title: 'Ask the researcher for more',
    confirm: 'Request information',
    fill: async (dialog) => {
      await dialog
        .getByLabel('What is missing?')
        .fill('The reproduction steps stop before the exploit lands.');
    },
    summary: 'A reviewer asked for more information. Answer to move it forward.',
    next: 'Waiting on the researcher. They must answer and resend the report before it can be decided.',
  },
  {
    trigger: 'Validate',
    title: 'Validate this report',
    confirm: 'Validate report',
    summary: 'Accepted. A reward decision comes next.',
    next: 'Approve reward',
  },
  {
    trigger: 'Reject',
    title: 'Reject this report',
    confirm: 'Reject report',
    fill: async (dialog) => {
      await dialog
        .getByLabel('Reason for rejection')
        .fill('The affected endpoint is listed as out of scope for this program.');
    },
    summary: 'Closed. A reviewer decided it is not eligible for this program.',
    next: 'This report is closed. Rejection is final.',
  },
  {
    trigger: 'Mark duplicate',
    title: 'Mark as a duplicate',
    confirm: 'Mark duplicate',
    fill: async (dialog) => {
      await dialog.getByLabel('Original report id').fill(IDS.duplicateTarget);
    },
    summary: 'Closed as a duplicate of an earlier report.',
    next: 'This report is closed as a duplicate. That decision is final.',
  },
];

for (const transition of TRANSITIONS) {
  test(`QA-E2E-008 ${transition.trigger} is confirmed through an AlertDialog`, async ({
    reviewerPage: page,
  }) => {
    let nativeDialogs = 0;
    page.on('dialog', (dialog) => {
      nativeDialogs += 1;
      void dialog.dismiss();
    });

    await page.goto(`/review/${IDS.report}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.getByRole('button', { name: transition.trigger, exact: true }).click();

    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(transition.title);
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();

    await transition.fill?.(dialog);
    await dialog.getByRole('button', { name: transition.confirm, exact: true }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(transition.summary)).toBeVisible();
    await expect(page.getByText(transition.next)).toBeVisible();

    expect(nativeDialogs, 'a native window.confirm was used instead of an AlertDialog').toBe(0);
  });
}

test('QA-E2E-008 cancelling an AlertDialog leaves the report untouched', async ({
  reviewerPage: page,
  api,
}) => {
  await page.goto(`/review/${IDS.report}`);

  await page.getByRole('button', { name: 'Reject', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(dialog).toBeHidden();
  expect(api.calls('POST', '/reject')).toHaveLength(0);
  await expect(page.getByText('Waiting for a reviewer to pick it up.')).toBeVisible();
});

test('QA-E2E-009 a range or flat tier sends the decided amount', async ({
  reviewerPage: page,
  api,
}) => {
  api.setReportStatus('validated');
  await page.goto(`/review/${IDS.report}`);

  await page.getByRole('button', { name: 'Approve reward', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('radio', { name: /Range or flat tier/ }).check();
  await dialog.getByLabel('Reward amount (USDC)').fill('2500');
  await dialog.getByRole('button', { name: 'Approve reward', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByText('A reward is approved and reserved against the program pool.')).toBeVisible();

  expect(api.lastBody('POST', '/approve-reward')).toEqual({ amount: '2500' });
});

test('QA-E2E-009 a percentage tier sends only the calculation basis, never an amount', async ({
  reviewerPage: page,
  api,
}) => {
  api.setReportStatus('validated');
  await page.goto(`/review/${IDS.report}`);

  await page.getByRole('button', { name: 'Approve reward', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();

  await dialog.getByRole('radio', { name: /Percentage tier/ }).check();
  // The reward amount field is replaced, not merely hidden: the client cannot decide the payout.
  await expect(dialog.getByLabel('Reward amount (USDC)')).toHaveCount(0);
  await expect(dialog.getByText('The server decides the amount')).toBeVisible();

  await dialog.getByLabel('Verified funds at risk (USDC)').fill('1200000');
  await dialog.getByRole('button', { name: 'Approve reward', exact: true }).click();

  await expect(dialog).toBeHidden();

  const body = api.lastBody('POST', '/approve-reward');
  expect(body).toEqual({ calculationBasisAmount: '1200000' });
  expect(body).not.toHaveProperty('amount');
});
