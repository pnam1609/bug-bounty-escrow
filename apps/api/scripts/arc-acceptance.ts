import { writeFile } from 'node:fs/promises';

import { LiveArcAcceptanceDriver } from './arc-acceptance/live-driver.js';
import {
  ARC_ACCEPTANCE_STEPS,
  AcceptanceAssertionError,
  ArcAcceptanceRunner,
  createArcAcceptanceState,
  exportRedactedEvidence,
  loadArcAcceptanceState,
  saveArcAcceptanceState,
  type ArcAcceptanceDriver,
} from './arc-acceptance/runner.js';

const args = process.argv.slice(2);
const command = args[0];
const options = readOptions(args.slice(1));
const statePath = requireOption(options, 'state');

if (
  [...options.keys()].some((key) =>
    /(?:signature|private.?key|seed|mnemonic|access.?token|api.?key|secret|bearer)/i.test(key),
  )
) {
  throw new Error(
    'Secret-bearing arguments are forbidden. The runner accepts only public IDs, addresses and hashes.',
  );
}

const unavailableDriver: ArcAcceptanceDriver = {
  verify: async () => {
    throw new AcceptanceAssertionError(
      'network_driver_unavailable',
      'This command must not perform a network check.',
      false,
    );
  },
};

switch (command) {
  case 'init': {
    const state = createArcAcceptanceState({
      apiOrigin: requireOption(options, 'api-origin'),
      webOrigin: requireOption(options, 'web-origin'),
      programId: requireOption(options, 'program-id'),
      reportId: requireOption(options, 'report-id'),
    });
    await saveArcAcceptanceState(statePath, state, { createOnly: true });
    print({
      runId: state.runId,
      stateSaved: true,
      next: 'advance --live-testnet',
      warning: 'No live request or wallet action was performed.',
    });
    break;
  }
  case 'status': {
    const state = await loadArcAcceptanceState(statePath);
    print(exportRedactedEvidence(state));
    break;
  }
  case 'advance':
  case 'retry': {
    requireLiveGuard(options);
    const state = await loadArcAcceptanceState(statePath);
    const expectedRevision = state.revision;
    const runner = new ArcAcceptanceRunner(state, liveDriver());
    if (command === 'retry') runner.retryFailedAssertion();
    const result = await runner.advance();
    await saveArcAcceptanceState(statePath, result.state, { expectedRevision });
    const failedStep = ARC_ACCEPTANCE_STEPS[result.state.currentStepIndex];
    const failed =
      failedStep !== undefined && result.state.steps[failedStep.id].status === 'failed';
    print(
      failed
        ? {
            failed: true,
            errorCode: result.state.diagnostics.at(-1)?.code ?? 'acceptance_check_failed',
          }
        : (result.checkpoint ?? {
            currentStepIndex: result.state.currentStepIndex,
            completed: result.state.currentStepIndex >= Object.keys(result.state.steps).length,
          }),
    );
    if (failed) process.exitCode = 1;
    break;
  }
  case 'record-signature': {
    const state = await loadArcAcceptanceState(statePath);
    const expectedRevision = state.revision;
    const runner = new ArcAcceptanceRunner(state, unavailableDriver);
    const saved = runner.recordSignatureEvidence({
      label: requireOption(options, 'label'),
      ...(readOption(options, 'operation-id') === undefined
        ? {}
        : { operationId: readOption(options, 'operation-id') }),
      ...(readOption(options, 'intent-id') === undefined
        ? {}
        : { intentId: readOption(options, 'intent-id') }),
      ...(readOption(options, 'deposit-id') === undefined
        ? {}
        : { depositId: readOption(options, 'deposit-id') }),
      ...(readOption(options, 'challenge-id') === undefined
        ? {}
        : { challengeId: readOption(options, 'challenge-id') }),
      ...(readOption(options, 'tx-hash') === undefined
        ? {}
        : { transactionHash: readOption(options, 'tx-hash') }),
      ...(readOption(options, 'address') === undefined
        ? {}
        : { address: readOption(options, 'address') }),
    });
    await saveArcAcceptanceState(statePath, saved, { expectedRevision });
    print({
      recorded: true,
      warning:
        'Only public evidence was stored. Run complete-signature only after every browser prompt in this boundary is finished.',
    });
    break;
  }
  case 'complete-signature': {
    const state = await loadArcAcceptanceState(statePath);
    const expectedRevision = state.revision;
    const runner = new ArcAcceptanceRunner(state, unavailableDriver);
    const saved = runner.completeSignatureBoundary();
    await saveArcAcceptanceState(statePath, saved, { expectedRevision });
    print({ completed: true, next: 'advance --live-testnet' });
    break;
  }
  case 'ack-reload': {
    requireLiveGuard(options);
    const state = await loadArcAcceptanceState(statePath);
    const expectedRevision = state.revision;
    const runner = new ArcAcceptanceRunner(state, liveDriver());
    const saved = await runner.acknowledgeReload();
    await saveArcAcceptanceState(statePath, saved, { expectedRevision });
    const step = ARC_ACCEPTANCE_STEPS[state.currentStepIndex];
    const acknowledged = step?.kind === 'reload' && saved.steps[step.id].status === 'passed';
    print({
      acknowledged,
      ...(acknowledged
        ? { next: 'advance --live-testnet' }
        : {
            errorCode: saved.diagnostics.at(-1)?.code ?? 'reload_verification_failed',
          }),
    });
    if (!acknowledged) process.exitCode = 1;
    break;
  }
  case 'ack-operator': {
    const state = await loadArcAcceptanceState(statePath);
    const expectedRevision = state.revision;
    const runner = new ArcAcceptanceRunner(state, unavailableDriver);
    const saved = runner.acknowledgeOperatorAction(readOption(options, 'operation-id'));
    await saveArcAcceptanceState(statePath, saved, { expectedRevision });
    print({ acknowledged: true, next: 'advance --live-testnet' });
    break;
  }
  case 'export': {
    const outputPath = requireOption(options, 'out');
    const evidence = exportRedactedEvidence(await loadArcAcceptanceState(statePath));
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: options.has('overwrite') ? 'w' : 'wx',
    });
    print({ exported: true });
    break;
  }
  default:
    throw new Error(
      'Usage: arc-acceptance <init|status|advance|retry|record-signature|complete-signature|ack-reload|ack-operator|export> --state <path>',
    );
}

function liveDriver(): LiveArcAcceptanceDriver {
  return new LiveArcAcceptanceDriver({
    accessToken: requireEnvironment('QA_ARC_ACCESS_TOKEN'),
    expectedOwnerId: requireEnvironment('QA_ARC_EXPECTED_OWNER_ID'),
    expectedApiOrigin: requireEnvironment('QA_ARC_EXPECTED_API_ORIGIN'),
    expectedWebOrigin: requireEnvironment('QA_ARC_EXPECTED_WEB_ORIGIN'),
    arcRpcUrl: requireEnvironment('ARC_RPC_URL'),
    arbitrumSepoliaRpcUrl: requireEnvironment('ARBITRUM_SEPOLIA_RPC_URL'),
    baseSepoliaRpcUrl: requireEnvironment('BASE_SEPOLIA_RPC_URL'),
    ethereumSepoliaRpcUrl: requireEnvironment('ETHEREUM_SEPOLIA_RPC_URL'),
    artifactPath: requireEnvironment('BOUNTY_ESCROW_ARTIFACT_PATH'),
    circleApiBaseUrl: 'https://api.circle.com',
    circleApiKey: requireEnvironment('CIRCLE_API_KEY'),
    circleDeploymentWalletId: requireEnvironment('CIRCLE_DEPLOYMENT_WALLET_ID'),
    gatewaySubscriptionId: requireSingleUuidEnvironment('CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS'),
  });
}

function requireLiveGuard(values: ReadonlyMap<string, string | true>): void {
  if (values.get('live-testnet') !== true) {
    throw new Error(
      'Refusing network access without --live-testnet. This flag permits read-only checks only; browser mutations remain manual.',
    );
  }
}

function readOptions(values: readonly string[]): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (!value.startsWith('--')) throw new Error('Unexpected positional argument.');
    const key = value.slice(2);
    const next = values[index + 1];
    if (next === undefined || next.startsWith('--')) {
      result.set(key, true);
    } else {
      result.set(key, next);
      index += 1;
    }
  }
  return result;
}

function readOption(values: ReadonlyMap<string, string | true>, key: string): string | undefined {
  const value = values.get(key);
  return typeof value === 'string' ? value : undefined;
}

function requireOption(values: ReadonlyMap<string, string | true>, key: string): string {
  const value = readOption(values, key);
  if (value === undefined) throw new Error(`--${key} is required`);
  return value;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

function requireSingleUuidEnvironment(name: string): string {
  const value = requireEnvironment(name).trim();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (value.includes(',') || !uuidPattern.test(value)) {
    throw new Error(`${name} must contain exactly one UUID`);
  }
  return value.toLowerCase();
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
