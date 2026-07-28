import { programResponseSchema } from '@bug-bounty-escrow/shared';

import { IDS, expect, test } from './fixtures';

/*
 * The owner create-program wizard. Every value is entered through a typed control — there is no
 * JSON textarea any more — and the payload is validated against `createProgramRequestSchema` by
 * the fixtures before a draft is returned.
 */

test('QA-E2E-007 the owner wizard builds a program from structured fields and reaches the draft screen', async ({
  ownerPage: page,
  api,
}) => {
  await page.goto('/owner/programs/new');

  // ------------------------------------------------------------------ overview
  await expect(page.getByRole('heading', { level: 1, name: 'Create a program' })).toBeVisible();
  await page.getByLabel('Program name').fill('Helios Vault');
  await page.getByLabel('Slug').fill('helios-vault');
  await page.getByLabel('Short summary').fill('Vault and staking contracts on Arc.');
  await page.getByLabel('Official website').fill('https://helios.example.test');
  await page.getByLabel('Tags').fill('DeFi');
  await page.getByLabel('Tags').press('Enter');
  await page
    .getByLabel('Program overview')
    .fill('Helios runs lending vaults and a staking core. Everything on Arc testnet is in scope.');
  await page.getByRole('button', { name: 'Continue to scope' }).click();

  // ------------------------------------------------------------------ scope
  await expect(page.getByRole('heading', { level: 1, name: 'Define program scope' })).toBeVisible();
  await page.getByRole('button', { name: 'Add scope' }).click();

  const scopeDialog = page.getByRole('dialog', { name: 'Add scope item' });
  await expect(scopeDialog).toBeVisible();
  await scopeDialog.getByLabel('Asset name').fill('Helios Core Contract');
  await scopeDialog.getByRole('button', { name: 'Add scope' }).click();
  await expect(scopeDialog).toBeHidden();

  await expect(page.getByText('Helios Core Contract', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to impacts' }).click();

  // ------------------------------------------------------------------ impacts
  // The platform catalog is seeded for the in-scope asset type, so this step is already valid.
  //
  // Reaching the checkbox by its label is the point of the assertion, not incidental to it: the
  // row and the control used to share one id, which left every impact checkbox with no accessible
  // name. Toggling by name is what keeps that from regressing silently.
  await expect(
    page.getByRole('heading', { level: 1, name: 'Define impacts in scope' }),
  ).toBeVisible();
  const theftOfFunds = page.getByRole('checkbox', { name: 'Direct theft of user funds' });
  await expect(theftOfFunds).toBeChecked();
  await theftOfFunds.uncheck();
  await expect(theftOfFunds).not.toBeChecked();
  await theftOfFunds.check();
  await expect(page.getByRole('heading', { level: 2, name: /impacts enabled/ })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to rewards' }).click();

  // ------------------------------------------------------------------ rewards
  await expect(page.getByRole('heading', { level: 1, name: 'Set reward tiers' })).toBeVisible();
  await page.getByLabel('Minimum reward').fill('10000');
  await page.getByLabel('Maximum reward').fill('50000');
  await page.getByRole('button', { name: 'Continue to rules' }).click();

  // ------------------------------------------------------------------ rules
  await expect(page.getByRole('heading', { level: 1, name: 'Set program rules' })).toBeVisible();
  await page
    .getByLabel('Reward and eligibility policy')
    .fill('Rewards follow the published tiers. Duplicates are decided by first valid submission.');
  await page.getByRole('button', { name: 'Review program' }).click();

  // ------------------------------------------------------------------ review and create
  await expect(page.getByRole('heading', { level: 1, name: 'Review your program' })).toBeVisible();
  await page.getByRole('button', { name: 'Create draft' }).click();

  await expect(page).toHaveURL(
    new RegExp(`/owner/programs/${IDS.createdProgram}/edit\\?created=1$`),
  );
  await expect(page.getByText('Draft created')).toBeVisible();
  await expect(page.getByText('Your program is saved and remains private.')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Helios Vault' })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Last saved /)).toBeVisible();

  const readiness = page.getByRole('list', { name: 'Program readiness checklist' });
  await expect(readiness.getByRole('listitem')).toHaveCount(8);
  for (const item of [
    'Program details',
    'Scope',
    'Impact catalog',
    'Reward tiers',
    'Program rules',
    'Escrow contract',
    'Funding',
    'Publishing',
  ]) {
    await expect(readiness.getByText(item, { exact: true })).toBeVisible();
  }

  await expect(page.getByRole('button', { name: 'Deploy escrow' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit program' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to programs' })).toBeVisible();
  await expect(page.getByText('Not visible to researchers')).toBeVisible();

  expect(api.lastBody('POST', '/api/programs')).toMatchObject({
    name: 'Helios Vault',
    slug: 'helios-vault',
    tags: ['DeFi'],
    scopes: [{ assetType: 'smart_contract', assetName: 'Helios Core Contract', isInScope: true }],
    rewardTiers: [
      { assetType: 'smart_contract', calculationType: 'range', minReward: '10000', maxReward: '50000' },
    ],
  });
});

test('program detail waits for the owner session before requesting a private draft', async ({
  ownerPage: page,
}) => {
  const authorizationHeaders: Array<string | undefined> = [];

  await page.route('**/api/programs/vault-rebuild-draft', async (route) => {
    if (route.request().method() === 'GET') {
      authorizationHeaders.push(route.request().headers()['authorization']);
    }
    await route.fallback();
  });

  await page.goto('/programs/vault-rebuild-draft');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Vault Rebuild Draft' }),
  ).toBeVisible();
  expect(authorizationHeaders).toEqual(['Bearer owner-access-token']);
});

test('CP-11 deploy locks the workflow, preserves an errored receipt and retries the same payload', async ({
  ownerPage: page,
}) => {
  const programPath = `/api/programs/${IDS.vaultDraft}`;
  const ownerProgramPath = `/api/owner/programs/${IDS.vaultDraft}`;
  const initialResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === ownerProgramPath &&
      response.request().method() === 'GET',
  );

  await page.goto(`/owner/programs/${IDS.vaultDraft}/edit`);
  const initialResponse = await initialResponsePromise;
  const initialProgram = programResponseSchema.parse(await initialResponse.json()).data;

  const contractAddress = '0x1111111111111111111111111111111111111111';
  const transactionHash = `0x${'a'.repeat(64)}`;
  const deployedProgram = programResponseSchema.parse({
    success: true,
    data: {
      ...initialProgram,
      status: 'awaiting_funding',
      contractAddress,
      updatedAt: '2026-07-27T00:00:00.000Z',
    },
  }).data;

  let releaseFirstAttempt!: () => void;
  const firstAttemptPending = new Promise<void>((resolve) => {
    releaseFirstAttempt = resolve;
  });
  const deploymentBodies: unknown[] = [];

  await page.route(`**${programPath}/deploy`, async (route) => {
    const request = route.request();
    const corsHeaders = {
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-origin': '*',
    };

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    deploymentBodies.push(request.postDataJSON());
    if (deploymentBodies.length === 1) {
      await firstAttemptPending;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: { code: 'database_unavailable', message: 'Temporarily unavailable' },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: deployedProgram }),
    });
  });

  await page.getByRole('button', { name: 'Deploy escrow' }).click();
  const dialog = page.getByRole('dialog', { name: 'Deploy escrow contract' });
  await dialog.getByLabel('Escrow contract address').fill(contractAddress);
  await dialog.getByLabel('Deployment transaction hash').fill(transactionHash);
  await dialog.getByRole('button', { name: 'Deploy escrow' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Preparing program escrow…' }),
  ).toBeVisible();
  await expect(page.getByText('Deploying contract', { exact: true })).toBeVisible();
  await expect(page.getByText('Vault Rebuild Draft', { exact: true })).toBeVisible();
  await expect(page.getByText('Arc testnet', { exact: true })).toBeVisible();
  await expect(page.getByText('USDC', { exact: true })).toBeVisible();

  const progress = page.getByRole('list', { name: 'Create program progress' });
  for (const completed of ['Overview', 'Scope', 'Impacts', 'Rewards', 'Rules', 'Review']) {
    await expect(progress.getByText(completed, { exact: true }).locator('..')).toHaveAttribute(
      'data-state',
      'completed',
    );
  }
  await expect(progress.getByText('Fund rewards', { exact: true }).locator('..')).toHaveAttribute(
    'data-state',
    'current',
  );

  await expect(page.locator('header a[href]')).toHaveCount(0);
  await expect(page.locator('aside a[href]')).toHaveCount(0);
  await expect(page.locator('footer a[href]')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);

  releaseFirstAttempt();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('Your draft and deployment details are still here.');
  await expect(dialog.getByLabel('Escrow contract address')).toHaveValue(contractAddress);
  await expect(dialog.getByLabel('Deployment transaction hash')).toHaveValue(transactionHash);

  await dialog.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Fund reward pool' })).toBeVisible();

  expect(deploymentBodies).toHaveLength(2);
  expect(deploymentBodies[1]).toEqual(deploymentBodies[0]);
});

test('CP-12 funding locks navigation, retains an errored receipt and reaches funded readiness', async ({
  ownerPage: page,
}) => {
  const programPath = `/api/programs/${IDS.vaultDraft}`;
  const ownerProgramPath = `/api/owner/programs/${IDS.vaultDraft}`;
  const initialResponsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === ownerProgramPath &&
      response.request().method() === 'GET',
  );

  await page.goto(`/owner/programs/${IDS.vaultDraft}/edit`);
  const initialResponse = await initialResponsePromise;
  const initialProgram = programResponseSchema.parse(await initialResponse.json()).data;

  const contractAddress = '0x1111111111111111111111111111111111111111';
  const deploymentHash = `0x${'a'.repeat(64)}`;
  const fundingHash = `0x${'b'.repeat(64)}`;
  const deployedProgram = programResponseSchema.parse({
    success: true,
    data: {
      ...initialProgram,
      status: 'awaiting_funding',
      publicStatus: null,
      contractAddress,
      updatedAt: '2026-07-27T00:00:00.000Z',
    },
  }).data;
  const fundedProgram = programResponseSchema.parse({
    success: true,
    data: {
      ...deployedProgram,
      totalPool: '185000',
      remainingPool: '185000',
      updatedAt: '2026-07-27T00:01:00.000Z',
    },
  }).data;
  const corsHeaders = {
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': '*',
  };

  await page.route(`**${programPath}/deploy`, async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: deployedProgram }),
    });
  });

  await page.getByRole('button', { name: 'Deploy escrow' }).click();
  const deploymentDialog = page.getByRole('dialog', { name: 'Deploy escrow contract' });
  await deploymentDialog.getByLabel('Escrow contract address').fill(contractAddress);
  await deploymentDialog.getByLabel('Deployment transaction hash').fill(deploymentHash);
  await deploymentDialog.getByRole('button', { name: 'Deploy escrow' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Fund reward pool' })).toBeVisible();
  await expect(page.getByText('0 USDC', { exact: true })).toBeVisible();
  await expect(page.getByText('Reward coverage', { exact: true })).toBeVisible();
  await expect(page.getByText('Arc testnet', { exact: true })).toBeVisible();
  await expect(page.getByText('Token', { exact: true }).locator('..')).toContainText('USDC');
  await expect(page.getByText('Escrow contract', { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      'USDC will be transferred to the program escrow. This does not publish the program.',
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.getByText('This build does not connect a wallet')).toBeVisible();

  await page.getByRole('button', { name: 'Do this later' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: initialProgram.name }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Fund rewards' }).click();

  let releaseFirstAttempt!: () => void;
  const firstAttemptPending = new Promise<void>((resolve) => {
    releaseFirstAttempt = resolve;
  });
  const fundingBodies: unknown[] = [];

  await page.route(`**${programPath}/fund`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }

    fundingBodies.push(request.postDataJSON());
    if (fundingBodies.length === 1) {
      await firstAttemptPending;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: { code: 'database_unavailable', message: 'Temporarily unavailable' },
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({ success: true, data: fundedProgram }),
    });
  });

  await page.route(`**/api/transactions/${fundingHash}`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: { code: 'not_found', message: 'Not found' },
      }),
    });
  });

  await page.getByLabel('Amount').fill('185000');
  await page.getByLabel('Transfer transaction hash').fill(fundingHash);
  await page.getByRole('button', { name: 'Fund reward pool' }).click();

  await expect(
    page.getByRole('heading', { level: 1, name: 'Funding reward pool…' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Transferring 185,000 USDC');
  await expect(page.getByRole('status')).toContainText(initialProgram.name);
  await expect(page.getByRole('status')).toContainText('0x1111…1111');
  await expect(page.getByRole('status')).toContainText('Amount185,000 USDC');
  await expect(page.getByRole('status')).toContainText('TokenUSDC');
  await expect(page.getByRole('status')).not.toContainText('Rewards funded');
  await expect(page.locator('header a[href]')).toHaveCount(0);
  await expect(page.locator('aside a[href]')).toHaveCount(0);
  await expect(page.locator('footer a[href]')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);

  releaseFirstAttempt();
  const fundingError = page
    .getByRole('alert')
    .filter({ hasText: 'The funding could not be recorded' });
  await expect(fundingError).toContainText('The amount and transfer hash are still here.');
  await expect(page.getByLabel('Amount')).toHaveValue('185000');
  await expect(page.getByLabel('Transfer transaction hash')).toHaveValue(fundingHash);

  await fundingError.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Reward pool funded' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Rewards funded');
  await expect(page.getByRole('status')).toContainText('185,000 USDC');
  await expect(page.getByText('Remaining', { exact: true }).locator('..')).toContainText(
    '185,000 USDC',
  );

  const readiness = page.getByRole('list', { name: 'Program readiness checklist' });
  await expect(readiness.locator('[data-readiness-item="escrow-contract"]')).toContainText(
    'Complete',
  );
  await expect(readiness.locator('[data-readiness-item="funding"]')).toContainText('Complete');
  await expect(page.getByRole('button', { name: 'Publish program' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to program' })).toBeVisible();
  await expect(page.getByText('Researchers still cannot see this program')).toBeVisible();

  expect(fundingBodies).toHaveLength(2);
  expect(fundingBodies[1]).toEqual(fundingBodies[0]);
});
