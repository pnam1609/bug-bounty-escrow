import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ARC_ACCEPTANCE_STEPS,
  AcceptanceAssertionError,
  ArcAcceptanceRunner,
  createArcAcceptanceState,
  exportRedactedEvidence,
  fingerprintPublicEvidence,
  loadArcAcceptanceState,
  saveArcAcceptanceState,
  type ArcAcceptanceDriver,
  type ArcAcceptanceState,
  type ArcAcceptanceStepId,
} from '../scripts/arc-acceptance/runner.js';

const PROGRAM_ID = '31990000-0000-4000-8000-000000000001';
const REPORT_ID = '33990000-0000-4000-8000-000000000001';
const INTENT_ID = '31990000-0000-4000-8000-000000000011';
const DEPOSIT_ID = '31990000-0000-4000-8000-000000000012';
const TX_HASH = `0x${'a'.repeat(64)}`;
const ADDRESS = `0x${'b'.repeat(40)}`;
const ESCROW_ADDRESS = `0x${'c'.repeat(40)}`;
const WITHDRAWAL_RECIPIENT = `0x${'d'.repeat(40)}`;
const NOW = new Date('2026-07-29T10:00:00.000Z');
const temporaryDirectories: string[] = [];
const API_DIRECTORY = fileURLToPath(new URL('..', import.meta.url));
const CLI_PATH = fileURLToPath(new URL('../scripts/arc-acceptance.ts', import.meta.url));
const ARTIFACT_PATH = fileURLToPath(
  new URL('../../../packages/contracts/artifacts/BountyEscrow.v1.json', import.meta.url),
);

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function runCli(
  cliArgs: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CLI_PATH, ...cliArgs], {
      cwd: API_DIRECTORY,
      env: { ...process.env, ...environment },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function state(): ArcAcceptanceState {
  return createArcAcceptanceState({
    apiOrigin: 'https://api.example.test',
    webOrigin: 'https://app.example.test',
    programId: PROGRAM_ID,
    reportId: REPORT_ID,
    now: NOW,
  });
}

function passingDriver(): ArcAcceptanceDriver {
  return {
    verify: vi.fn(async (stepId: ArcAcceptanceStepId, current: Readonly<ArcAcceptanceState>) => {
      const reloadSource = {
        reload_after_deploy: 'deploy_verify',
        reload_after_send: 'send_verify',
        reload_after_bridge: 'bridge_verify',
        reload_before_cp13: 'ub_spend_verify',
        reload_after_close: 'close_verify',
      } as const;
      const source = reloadSource[stepId as keyof typeof reloadSource];
      if (source !== undefined) {
        const evidence = current.evidence
          .filter(({ stepId: evidenceStep }) => evidenceStep === source)
          .map(({ stepId, recordedAt, ...item }) => {
            void stepId;
            void recordedAt;
            return item;
          });
        return {
          evidence,
          durableFingerprint: fingerprintPublicEvidence(evidence),
        };
      }
      return {
        evidence: [
          {
            kind: 'invariant' as const,
            label: `${stepId}_passed`,
            invariantPassed: true,
          },
        ],
      };
    }),
  };
}

async function reachFirstSignature(runner: ArcAcceptanceRunner): Promise<void> {
  await runner.advance();
  await runner.advance();
  const result = await runner.advance();
  expect(result.checkpoint).toMatchObject({
    kind: 'signature',
    stepId: 'deploy_wallet_challenge',
  });
}

describe('QA-ARC-01 durable acceptance state machine', () => {
  it('pauses at every manual signature and never asks the driver to sign', async () => {
    const driver = passingDriver();
    const runner = new ArcAcceptanceRunner(state(), driver, () => NOW);
    await reachFirstSignature(runner);

    expect(driver.verify).toHaveBeenCalledTimes(2);
    expect(runner.snapshot().steps.deploy_wallet_challenge.status).toBe('waiting_signature');
    await expect(runner.advance()).resolves.toMatchObject({
      checkpoint: {
        warning: expect.stringContaining('Never paste a signature, private key, or seed phrase'),
      },
    });
    expect(driver.verify).toHaveBeenCalledTimes(2);
  });

  it('requires public durable evidence and rejects a conflicting blind retry', async () => {
    const runner = new ArcAcceptanceRunner(state(), passingDriver(), () => NOW);
    await reachFirstSignature(runner);

    expect(() => runner.completeSignatureBoundary()).toThrow(
      'Record the required durable public intent',
    );
    const first = runner.recordSignatureEvidence({
      label: 'wallet_challenge_signed_in_browser',
      operationId: 'wallet_proof:attempt:1',
      challengeId: INTENT_ID,
      address: ADDRESS,
    });
    expect(first.evidence).toHaveLength(3);
    expect(
      runner.recordSignatureEvidence({
        label: 'wallet_challenge_signed_in_browser',
        operationId: 'wallet_proof:attempt:1',
        challengeId: INTENT_ID,
        address: ADDRESS,
      }).evidence,
    ).toHaveLength(3);
    expect(() =>
      runner.recordSignatureEvidence({
        label: 'different_result_for_same_operation',
        operationId: 'wallet_proof:attempt:1',
        transactionHash: TX_HASH,
      }),
    ).toThrow('never blind-retry');
  });

  it('persists atomically and resumes at the exact checkpoint', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qa-arc-runner-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'state.json');
    const runner = new ArcAcceptanceRunner(state(), passingDriver(), () => NOW);
    await reachFirstSignature(runner);
    runner.recordSignatureEvidence({
      label: 'browser_wallet_challenge',
      operationId: 'wallet_proof:attempt:1',
      challengeId: INTENT_ID,
      address: ADDRESS,
    });
    await saveArcAcceptanceState(path, runner.snapshot());

    const raw = await readFile(path, 'utf8');
    expect(raw).not.toContain('privateKey');
    const resumed = new ArcAcceptanceRunner(
      await loadArcAcceptanceState(path),
      passingDriver(),
      () => NOW,
    );
    expect((await resumed.advance()).checkpoint?.stepId).toBe('deploy_wallet_challenge');
    resumed.completeSignatureBoundary();
    expect(resumed.snapshot().currentStepIndex).toBe(3);
  });

  it('keeps failed assertions recoverable with bounded diagnostics', async () => {
    let available = false;
    const driver: ArcAcceptanceDriver = {
      verify: vi.fn(async () => {
        if (!available) {
          throw new AcceptanceAssertionError(
            'arc_receipt_pending',
            'The known transaction receipt is still pending.',
          );
        }
        return { evidence: [] };
      }),
    };
    const runner = new ArcAcceptanceRunner(state(), driver, () => NOW);

    expect((await runner.advance()).state.steps.dedicated_draft.status).toBe('failed');
    expect(runner.snapshot().diagnostics).toEqual([
      expect.objectContaining({
        code: 'arc_receipt_pending',
        retryable: true,
      }),
    ]);
    await expect(runner.advance()).rejects.toThrow('explicitly retried');
    available = true;
    runner.retryFailedAssertion();
    expect((await runner.advance()).state.steps.dedicated_draft.status).toBe('passed');
  });

  it('keeps the live CLI guard boolean-exact and exits nonzero with a stable assertion code', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qa-arc-cli-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'state.json');
    const cliState = createArcAcceptanceState({
      apiOrigin: 'https://attacker.example.test',
      webOrigin: 'https://app.example.test',
      programId: PROGRAM_ID,
      reportId: REPORT_ID,
      now: NOW,
    });
    await saveArcAcceptanceState(path, cliState, { createOnly: true });

    const falseGuard = await runCli(['advance', '--state', path, '--live-testnet', 'false']);
    expect(falseGuard.code).not.toBe(0);
    expect(falseGuard.stderr).toContain('Refusing network access');
    expect((await loadArcAcceptanceState(path)).revision).toBe(cliState.revision);

    const liveEnvironment = {
      QA_ARC_ACCESS_TOKEN: 'acceptance-token-never-exported',
      QA_ARC_EXPECTED_OWNER_ID: '30990000-0000-4000-8000-000000000001',
      QA_ARC_EXPECTED_API_ORIGIN: 'https://api.example.test',
      QA_ARC_EXPECTED_WEB_ORIGIN: 'https://app.example.test',
      ARC_RPC_URL: 'https://arc-rpc.example.test',
      BASE_SEPOLIA_RPC_URL: 'https://base-rpc.example.test',
      ARBITRUM_SEPOLIA_RPC_URL: 'https://arb-rpc.example.test',
      ETHEREUM_SEPOLIA_RPC_URL: 'https://ethereum-rpc.example.test',
      BOUNTY_ESCROW_ARTIFACT_PATH: ARTIFACT_PATH,
      CIRCLE_API_KEY: 'circle-key-never-exported',
      CIRCLE_DEPLOYMENT_WALLET_ID: '31990000-0000-4000-8000-000000000031',
      CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: '31990000-0000-4000-8000-000000000032',
    };
    const failedAssertion = await runCli(
      ['advance', '--state', path, '--live-testnet'],
      liveEnvironment,
    );
    expect(failedAssertion.code).toBe(1);
    expect(JSON.parse(failedAssertion.stdout)).toEqual({
      failed: true,
      errorCode: 'acceptance_api_origin_mismatch',
    });
    expect(failedAssertion.stdout).not.toMatch(/acceptance-token|circle-key/i);
    expect((await loadArcAcceptanceState(path)).diagnostics.at(-1)).toMatchObject({
      code: 'acceptance_api_origin_mismatch',
      retryable: false,
    });

    const failedRetry = await runCli(['retry', '--state', path, '--live-testnet'], liveEnvironment);
    expect(failedRetry.code).toBe(1);
    expect(JSON.parse(failedRetry.stdout)).toMatchObject({
      failed: true,
      errorCode: 'acceptance_api_origin_mismatch',
    });

    const invalidAllowlist = await runCli(['retry', '--state', path, '--live-testnet'], {
      ...liveEnvironment,
      CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS:
        '31990000-0000-4000-8000-000000000032,31990000-0000-4000-8000-000000000033',
    });
    expect(invalidAllowlist.code).not.toBe(0);
    expect(invalidAllowlist.stderr).toContain(
      'CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS must contain exactly one UUID',
    );
    expect(invalidAllowlist.stderr).not.toContain('31990000-0000-4000-8000-000000000032');
  }, 15_000);

  it('GET-verifies the exact durable reload projection and fails a changed fingerprint', async () => {
    const driver = passingDriver();
    vi.mocked(driver.verify).mockImplementation(async (stepId) => {
      if (stepId === 'reload_after_deploy') {
        return {
          evidence: [],
          durableFingerprint: `0x${'f'.repeat(64)}`,
        };
      }
      return {
        evidence: [
          {
            kind: 'invariant',
            label: `${stepId}_passed`,
            invariantPassed: true,
            ...(stepId === 'deploy_verify'
              ? {
                  transactionHash: TX_HASH,
                  durableStatus: 'confirmed' as const,
                }
              : {}),
          },
        ],
      };
    });
    const runner = new ArcAcceptanceRunner(state(), driver, () => NOW);
    await reachFirstSignature(runner);
    runner.recordSignatureEvidence({
      label: 'wallet_challenge_signed_in_browser',
      challengeId: INTENT_ID,
      address: ADDRESS,
    });
    runner.completeSignatureBoundary();
    await runner.advance();
    expect((await runner.advance()).checkpoint?.stepId).toBe('reload_after_deploy');

    const reloaded = await runner.acknowledgeReload();
    expect(reloaded.steps.reload_after_deploy.status).toBe('failed');
    expect(reloaded.diagnostics.at(-1)).toMatchObject({
      code: 'reload_projection_mismatch',
    });
    expect(driver.verify).toHaveBeenLastCalledWith(
      'reload_after_deploy',
      expect.objectContaining({ programId: PROGRAM_ID }),
    );
  });

  it('uses compare-and-swap revisions so two resumed processes cannot overwrite state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'qa-arc-runner-cas-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'state.json');
    const original = state();
    await saveArcAcceptanceState(path, original, { createOnly: true });
    const first = await loadArcAcceptanceState(path);
    const stale = await loadArcAcceptanceState(path);

    const firstRunner = new ArcAcceptanceRunner(first, passingDriver(), () => NOW);
    const firstResult = await firstRunner.advance();
    await saveArcAcceptanceState(path, firstResult.state, {
      expectedRevision: first.revision,
    });

    const staleRunner = new ArcAcceptanceRunner(stale, passingDriver(), () => NOW);
    const staleResult = await staleRunner.advance();
    await expect(
      saveArcAcceptanceState(path, staleResult.state, {
        expectedRevision: stale.revision,
      }),
    ).rejects.toMatchObject({ code: 'state_write_conflict' });
    expect((await loadArcAcceptanceState(path)).revision).toBe(firstResult.state.revision);
  });

  it('exports an allowlisted artifact without private report IDs or secret canaries', async () => {
    const secretCanaries = [
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJxdWEifQ.signature',
      'CIRCLE_API_KEY=TEST_KEY_SHOULD_NEVER_EXPORT',
      'owner-private@example.test',
      '0xfeed-private-key-canary',
    ];
    const driver: ArcAcceptanceDriver = {
      verify: vi.fn(async () => {
        throw new Error(secretCanaries.join(' '));
      }),
    };
    const runner = new ArcAcceptanceRunner(state(), driver, () => NOW);
    await runner.advance();
    const withPublicAddresses = runner.snapshot();
    withPublicAddresses.evidence.push(
      {
        stepId: 'deploy_verify',
        recordedAt: NOW.toISOString(),
        kind: 'address',
        label: 'verified_escrow_address',
        address: ESCROW_ADDRESS,
      },
      {
        stepId: 'withdraw_verify',
        recordedAt: NOW.toISOString(),
        kind: 'transaction',
        label: 'remaining_funds_withdrawn',
        address: WITHDRAWAL_RECIPIENT,
        transactionHash: TX_HASH,
      },
      {
        stepId: 'bridge_verify',
        recordedAt: NOW.toISOString(),
        kind: 'address',
        label: 'bridge_source_owner',
        address: ADDRESS,
      },
    );
    const serialized = JSON.stringify(exportRedactedEvidence(withPublicAddresses));

    expect(serialized).not.toContain(REPORT_ID);
    for (const canary of secretCanaries) expect(serialized).not.toContain(canary);
    expect(serialized).toContain('acceptance_check_failed');
    expect(serialized).toContain(ESCROW_ADDRESS);
    expect(serialized).toContain(WITHDRAWAL_RECIPIENT);
    expect(serialized).not.toContain(ADDRESS);
    expect(() =>
      createArcAcceptanceState({
        apiOrigin: 'https://api.example.test/?access_token=forbidden',
        webOrigin: 'https://app.example.test',
        programId: PROGRAM_ID,
        reportId: REPORT_ID,
      }),
    ).toThrow('Origins must not contain credentials');
  });

  it('can traverse the complete plan with explicit signature/reload/operator acknowledgements', async () => {
    const runner = new ArcAcceptanceRunner(state(), passingDriver(), () => NOW);
    let safety = 0;
    while (runner.snapshot().currentStepIndex < ARC_ACCEPTANCE_STEPS.length) {
      if (safety++ > 100) throw new Error('runner did not terminate');
      const result = await runner.advance();
      if (result.checkpoint?.kind === 'signature') {
        runner.recordSignatureEvidence({
          label: `${result.checkpoint.stepId}_public_operation`,
          operationId: `${result.checkpoint.stepId}:attempt:1`,
          intentId: INTENT_ID,
          challengeId:
            result.checkpoint.stepId === 'deploy_wallet_challenge' ? INTENT_ID : undefined,
          depositId: result.checkpoint.stepId.includes('deposit') ? DEPOSIT_ID : undefined,
          transactionHash: TX_HASH,
          address: ADDRESS,
        });
        runner.completeSignatureBoundary();
      } else if (result.checkpoint?.kind === 'reload') {
        await runner.acknowledgeReload();
      } else if (result.checkpoint?.kind === 'operator') {
        runner.acknowledgeOperatorAction('end_program:action:1');
      }
    }

    const exported = exportRedactedEvidence(runner.snapshot());
    expect(exported).toMatchObject({ completed: true, programId: PROGRAM_ID });
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toMatch(/token|secret|mnemonic|private.?key/i);
    expect(serialized).not.toContain(ADDRESS);
    expect(serialized).not.toContain(REPORT_ID);
    expect(serialized.length).toBeLessThan(100_000);
  });
});
