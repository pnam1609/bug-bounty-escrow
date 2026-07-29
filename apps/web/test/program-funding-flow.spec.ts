import { describe, expect, it, vi } from 'vitest';

import {
  assertConnectedWalletAccount,
  arcCombinedNativeDebitBaseUnits,
  bridgeRecoveryTelemetry,
  canRetryBridgeResult,
  CircleAppKitFundingExecutor,
  requiresSourceWalletBalanceCheck,
  sumUsdcFees,
  unifiedBalanceFeeReserveByNetwork,
  unifiedBalanceSourceDebitFeeTotal,
} from '@/components/owner/circle-funding-executor';
import {
  canStartDestinationOperation,
  assertFreshFundingQuoteMatchesIntent,
  assertSelectedUnifiedBalanceReadiness,
  connectBrowserWallet,
  clearPendingFundingResult,
  clearPendingSourceDepositHash,
  deriveFundingRoute,
  executeVerifiedFundingIntent,
  executePreparedFundingSubmission,
  fundingContinuationAction,
  fundingSubmissionFailurePhase,
  fundingSourceForLockedDeposit,
  fundingSourceSubmittedRecoveryMessage,
  fundingRecoveryAction,
  formatUsdcBaseUnits,
  parseUsdcBaseUnits,
  persistPendingFundingResult,
  persistPendingSourceDepositHash,
  readPendingFundingResult,
  readPendingSourceDepositHash,
  sourceDepositContinuationAction,
  validateFundingSelection,
  type FundingSource,
  type FundingExecutionAdapter,
} from '@/components/owner/program-funding-flow';

function source(
  rowId: string,
  network: FundingSource['network'],
  amount: string,
): FundingSource {
  return { rowId, network, amount };
}

describe('CP-11 funding selection', () => {
  it('derives Send, Bridge and Unified Balance without a manual route selector', () => {
    expect(deriveFundingRoute([source('arc', 'Arc_Testnet', '10')])).toBe('send');
    expect(deriveFundingRoute([source('base', 'Base_Sepolia', '10')])).toBe('bridge');
    expect(
      deriveFundingRoute([
        source('base', 'Base_Sepolia', '4'),
        source('arb', 'Arbitrum_Sepolia', '6'),
      ]),
    ).toBe('unified_balance');
  });

  it('parses USDC exactly at 6 decimals without JavaScript floating point', () => {
    expect(parseUsdcBaseUnits('9007199254740993.123456')).toBe(9_007_199_254_740_993_123_456n);
    expect(formatUsdcBaseUnits(9_007_199_254_740_993_123_456n)).toBe(
      '9007199254740993.123456',
    );
    expect(parseUsdcBaseUnits('1.1234567')).toBeUndefined();
    expect(parseUsdcBaseUnits('-1')).toBeUndefined();
  });

  it('rejects duplicate networks and allocation totals that differ from gross', () => {
    const result = validateFundingSelection('10', [
      source('one', 'Base_Sepolia', '4'),
      source('two', 'Base_Sepolia', '5'),
    ]);

    expect(result.selection).toBeUndefined();
    expect(result.errors['sources.two.network']).toContain('only be selected once');
    expect(result.errors['sources.total']).toContain('must equal');
  });

  it('returns an immutable normalized selection for a valid multi-source plan', () => {
    const sources = [
      source('one', 'Ethereum_Sepolia', '4.500000'),
      source('two', 'Arc_Testnet', '5.5'),
    ];
    const result = validateFundingSelection('10.000000', sources);

    expect(result.errors).toEqual({});
    expect(result.selection).toMatchObject({
      grossAmount: '10',
      grossBaseUnits: 10_000_000n,
      routeMode: 'unified_balance',
    });
    expect(result.selection?.sources).not.toBe(sources);
  });

  it('keeps spend allocation at gross while signing the exact server-locked fee top-up', () => {
    const allocation = source('eth', 'Ethereum_Sepolia', '10');
    const initialLockedDeposit = fundingSourceForLockedDeposit(allocation, {
      network: 'Ethereum_Sepolia',
      amount: '10.1',
    });
    const laterQuoteDeltaTopUp = fundingSourceForLockedDeposit(allocation, {
      network: 'Ethereum_Sepolia',
      amount: '0.025',
    });

    expect(allocation.amount).toBe('10');
    expect(initialLockedDeposit).toEqual({
      rowId: 'eth',
      network: 'Ethereum_Sepolia',
      amount: '10.1',
    });
    expect(laterQuoteDeltaTopUp).toEqual({
      rowId: 'eth',
      network: 'Ethereum_Sepolia',
      amount: '0.025',
    });
    expect(() =>
      fundingSourceForLockedDeposit(allocation, {
        network: 'Base_Sepolia',
        amount: '10.125',
      }),
    ).toThrow('does not match this allocation');
  });
});

describe('CP-12 wallet and retry safety', () => {
  it('keeps a rejected Unified Balance readiness/network switch before the durable boundary', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const events: string[] = [];
    const provider = { request: vi.fn(async () => [address]) };
    const adapter = {
      getAddress: vi.fn(async () => address),
      readContract: vi.fn(
        async ({ functionName }: { readonly functionName: string }) =>
          functionName === 'decimals' ? 6 : 10_000_000n,
      ),
      ensureChain: vi.fn(async () => {
        events.push('switch');
        throw new Error('network switch rejected');
      }),
    };
    const executor = new CircleAppKitFundingExecutor(
      adapter as never,
      provider as never,
      address,
    );
    const prepare = vi.fn(() =>
      executor.prepareUnifiedBalanceDepositSource(
        source('base', 'Base_Sepolia', '2'),
      ),
    );
    const lock = vi.fn(async () => {
      events.push('lock');
    });
    const submit = vi.fn(async () => {
      events.push('submit');
      return 'submitted';
    });

    await expect(executePreparedFundingSubmission(prepare, lock, submit)).rejects.toThrow(
      'network switch rejected',
    );
    expect(adapter.readContract).toHaveBeenCalledTimes(2);
    expect(adapter.ensureChain).toHaveBeenCalledOnce();
    expect(events).toEqual(['switch']);
    expect(lock).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits a Unified Balance deposit only after the durable boundary is locked', async () => {
    const events: string[] = [];
    const result = await executePreparedFundingSubmission(
      async () => {
        events.push('prepare');
      },
      async () => {
        events.push('lock');
      },
      async () => {
        events.push('submit');
        return 'submitted';
      },
    );

    expect(result).toBe('submitted');
    expect(events).toEqual(['prepare', 'lock', 'submit']);
  });

  it('fails source native-gas readiness before the durable deposit boundary', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const provider = {
      request: vi.fn(async ({ method }: { readonly method: string }) => {
        if (method === 'eth_accounts') return [address];
        if (method === 'eth_estimateGas') return '0x5208';
        if (method === 'eth_gasPrice') return '0x10';
        throw new Error(`Unexpected method ${method}`);
      }),
    };
    const adapter = {
      getAddress: vi.fn(async () => address),
      readContract: vi.fn(
        async ({ functionName }: { readonly functionName: string }) =>
          functionName === 'decimals' ? 6 : 10_000_000n,
      ),
      ensureChain: vi.fn(async () => undefined),
      readNativeBalance: vi.fn(async () => 1n),
    };
    const executor = new CircleAppKitFundingExecutor(
      adapter as never,
      provider as never,
      address,
    );
    const lock = vi.fn(async () => undefined);

    await expect(
      executePreparedFundingSubmission(
        () =>
          executor.prepareUnifiedBalanceDepositSource(
            source('base', 'Base_Sepolia', '2'),
          ),
        lock,
        vi.fn(async () => 'submitted'),
      ),
    ).rejects.toThrow('needs more testnet ETH for gas');
    expect(lock).not.toHaveBeenCalled();
  });

  it('combines Arc canonical USDC debit and 18-decimal native gas before signing', () => {
    const gross = 2_000_000n;
    const gas = 21_000n;
    const combined = arcCombinedNativeDebitBaseUnits(gross, gas);

    expect(combined).toBe(2_000_000_000_000_021_000n);
    expect(combined).toBeGreaterThan(gross * 1_000_000_000_000n);
    expect(combined).toBeGreaterThan(gas);
  });

  it('persists bounded bridge steps without serializing raw provider errors', () => {
    const burnHash = `0x${'a'.repeat(64)}`;
    const providerError = new Error('private provider details');
    const result = {
      state: 'error',
      steps: [
        { name: 'Burn', state: 'success', txHash: burnHash },
        {
          name: 'Mint',
          state: 'error',
          error: providerError,
          errorCategory: 'failed_offchain',
        },
      ],
    } as never;

    expect(bridgeRecoveryTelemetry(result)).toEqual({
      providerState: 'error',
      retryable: false,
      submissionUncertain: false,
      sourceTransactionHashes: [burnHash],
      steps: [
        { name: 'Burn', state: 'success', transactionHash: burnHash },
        { name: 'Mint', state: 'error', errorCode: 'failed_offchain' },
      ],
    });
    expect(JSON.stringify(bridgeRecoveryTelemetry(result))).not.toContain(
      'private provider details',
    );
    expect(canRetryBridgeResult(result)).toBe(false);
  });

  it('opens the account permission request only when connect is explicitly called', async () => {
    const request = vi.fn(async () => ['0x1111111111111111111111111111111111111111']);
    expect(request).not.toHaveBeenCalled();

    await expect(connectBrowserWallet({ request })).resolves.toBe(
      '0x1111111111111111111111111111111111111111',
    );
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' });
  });

  it('fails before signing when the active injected account changed', async () => {
    const provider = {
      request: vi.fn(async () => ['0x2222222222222222222222222222222222222222']),
    };
    await expect(
      assertConnectedWalletAccount(
        provider as never,
        '0x1111111111111111111111111111111111111111',
      ),
    ).rejects.toThrow('active wallet account changed');
    expect(provider.request).toHaveBeenCalledWith({
      method: 'eth_accounts',
      params: undefined,
    });
  });

  it('sums only complete USDC quote fees and fails closed for unknown fee evidence', () => {
    expect(
      sumUsdcFees([
        { token: 'USDC', amount: '0.000001' },
        { token: 'usdc', amount: '0.1' },
      ]),
    ).toBe(100_001n);
    expect(() => sumUsdcFees([{ token: 'ETH', amount: '0.1' }])).toThrow(
      'Unsupported fee token',
    );
    expect(() => sumUsdcFees([{ token: 'USDC', amount: null }])).toThrow(
      'complete USDC fee estimate',
    );
  });

  it('uses only provider and gas fees as per-source Unified Balance headroom', () => {
    const supportedFees = [
      {
        type: 'provider' as const,
        token: 'USDC',
        amount: '0.01',
        allocations: [{ chain: 'Ethereum_Sepolia', amount: '0.01' }],
      },
      {
        type: 'gasFee' as const,
        token: 'USDC',
        amount: '0.02',
        allocations: [{ chain: 'Base_Sepolia', amount: '0.02' }],
      },
      { type: 'kit' as const, token: 'USDC', amount: '0' },
      { type: 'forwarder' as const, token: 'USDC', amount: '0' },
    ];
    expect(unifiedBalanceSourceDebitFeeTotal(supportedFees)).toBe(30_000n);
    expect(
      unifiedBalanceFeeReserveByNetwork(supportedFees, [
        'Ethereum_Sepolia',
        'Base_Sepolia',
      ]),
    ).toEqual({
      Ethereum_Sepolia: '0.01',
      Base_Sepolia: '0.02',
    });
    expect(() =>
      unifiedBalanceSourceDebitFeeTotal([
        { type: 'kit', token: 'USDC', amount: '0.01' },
      ]),
    ).toThrow('kit fees are disabled');
    expect(() =>
      unifiedBalanceSourceDebitFeeTotal([
        { type: 'forwarder', token: 'USDC', amount: '0.01' },
      ]),
    ).toThrow('forwarder fees are disabled');
    expect(() =>
      unifiedBalanceFeeReserveByNetwork(
        [{ type: 'provider', token: 'USDC', amount: '0.01' }],
        ['Ethereum_Sepolia', 'Base_Sepolia'],
      ),
    ).toThrow('missing its required per-chain allocation');
  });

  it('rejects sufficient aggregate Unified Balance held on the wrong selected domain', () => {
    const selection = validateFundingSelection('100', [
      source('base', 'Base_Sepolia', '50'),
      source('arb', 'Arbitrum_Sepolia', '50'),
    ]).selection!;
    expect(() =>
      assertSelectedUnifiedBalanceReadiness(
        selection,
        {
          confirmedAmount: '101',
          pendingAmount: '0',
          confirmedByNetwork: {
            Ethereum_Sepolia: '101',
            Base_Sepolia: '0',
            Arbitrum_Sepolia: '0',
          },
          pendingByNetwork: {},
        },
        {
          estimatedFeeReserveByNetwork: {
            Base_Sepolia: '0.01',
            Arbitrum_Sepolia: '0.01',
          },
        },
      ),
    ).toThrow('Base Sepolia confirmed Unified Balance');
  });

  it('uses selected-domain readiness even when aggregate telemetry is stale', () => {
    const selection = validateFundingSelection('100', [
      source('base', 'Base_Sepolia', '50'),
      source('arb', 'Arbitrum_Sepolia', '50'),
    ]).selection!;
    expect(() =>
      assertSelectedUnifiedBalanceReadiness(
        selection,
        {
          confirmedAmount: '0',
          pendingAmount: '999',
          confirmedByNetwork: {
            Base_Sepolia: '50.01',
            Arbitrum_Sepolia: '50.02',
          },
          pendingByNetwork: {},
        },
        {
          estimatedFeeReserveByNetwork: {
            Base_Sepolia: '0.01',
            Arbitrum_Sepolia: '0.02',
          },
        },
      ),
    ).not.toThrow();
  });

  it('fails source readiness when any selected network lacks canonical USDC', async () => {
    const address = '0x1111111111111111111111111111111111111111';
    const provider = {
      request: vi.fn(async () => [address]),
    };
    const adapter = {
      getAddress: vi.fn(async () => address),
      readContract: vi.fn(
        async ({ functionName }: { readonly functionName: string }) =>
          functionName === 'decimals' ? 6 : 3_000_000n,
      ),
    };
    const executor = new CircleAppKitFundingExecutor(
      adapter as never,
      provider as never,
      address,
    );

    await expect(
      executor.assertFundingSourceBalances([
        source('eth', 'Ethereum_Sepolia', '4'),
        source('base', 'Base_Sepolia', '2'),
      ]),
    ).rejects.toThrow('Ethereum Sepolia does not have enough canonical USDC');
  });

  it('does not require source-wallet USDC when confirmed Unified Balance will be spent', () => {
    expect(requiresSourceWalletBalanceCheck('unified_balance')).toBe(false);
    expect(requiresSourceWalletBalanceCheck('send')).toBe(true);
    expect(requiresSourceWalletBalanceCheck('bridge')).toBe(true);
  });

  it('blocks an expired or changed fee quote before a destination signature', () => {
    const intent = {
      estimatedFeeReserve: '0.1',
      feeAllocations: [{ network: 'Arc_Testnet', amount: '0.1' }],
    } as never;
    const baseQuote = {
      estimatedFeeReserve: '0.1',
      estimatedFeeReserveBaseUnits: 100_000n,
      estimatedFeeReserveByNetwork: { Arc_Testnet: '0.1' },
      quotedAt: '2026-07-29T00:00:00.000Z',
      expiresAt: '2026-07-29T00:02:00.000Z',
    };
    expect(() =>
      assertFreshFundingQuoteMatchesIntent(
        intent,
        baseQuote,
        Date.parse('2026-07-29T00:01:00.000Z'),
      ),
    ).not.toThrow();
    expect(() =>
      assertFreshFundingQuoteMatchesIntent(
        intent,
        baseQuote,
        Date.parse('2026-07-29T00:03:00.000Z'),
      ),
    ).toThrow('quote expired');
    expect(() =>
      assertFreshFundingQuoteMatchesIntent(
        intent,
        { ...baseQuote, estimatedFeeReserve: '0.2', estimatedFeeReserveBaseUnits: 200_000n },
        Date.parse('2026-07-29T00:01:00.000Z'),
      ),
    ).toThrow('fees changed');
  });

  it('recovers a returned destination hash without signing a replacement transaction', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;
    const result = {
      routeMode: 'send' as const,
      destinationTransactionHash: `0x${'a'.repeat(64)}`,
      sourceTransactionHashes: [`0x${'a'.repeat(64)}`],
    };
    persistPendingFundingResult(storage, 'program', 'intent', result);
    expect(readPendingFundingResult(storage, 'program', 'intent')).toEqual(result);
    expect(fundingContinuationAction('source_submitted', false, true)).toBe(
      'observe_destination',
    );
    clearPendingFundingResult(storage, 'program', 'intent');
    expect(readPendingFundingResult(storage, 'program', 'intent')).toBeUndefined();
  });

  it('preserves a returned source-deposit hash until the API durably observes it', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;
    const depositHash = `0x${'b'.repeat(64)}`;
    persistPendingSourceDepositHash(storage, 'program', 'intent', 'deposit', depositHash);
    expect(readPendingSourceDepositHash(storage, 'program', 'intent', 'deposit')).toBe(
      depositHash,
    );
    clearPendingSourceDepositHash(storage, 'program', 'intent', 'deposit');
    expect(
      readPendingSourceDepositHash(storage, 'program', 'intent', 'deposit'),
    ).toBeUndefined();
  });

  it('resumes only before the durable wallet boundary and never replays after it', () => {
    const claimed = {
      id: 'deposit',
      status: 'awaiting_signature',
    } as never;
    expect(sourceDepositContinuationAction(claimed, undefined, undefined)).toBe(
      'execute_claimed',
    );
    expect(
      sourceDepositContinuationAction(claimed, `0x${'c'.repeat(64)}`, undefined),
    ).toBe('observe_local_hash');
    expect(
      sourceDepositContinuationAction(claimed, undefined, `0x${'d'.repeat(64)}`),
    ).toBe('attach_manual_hash');
    expect(
      sourceDepositContinuationAction(
        {
          id: 'deposit',
          status: 'submitted',
          transactionHash: `0x${'c'.repeat(64)}`,
        } as never,
        undefined,
        undefined,
      ),
    ).toBe('reconcile');
    expect(
      sourceDepositContinuationAction(
        { id: 'deposit', status: 'submission_uncertain' } as never,
        undefined,
        undefined,
      ),
    ).toBe('recovery_required');
    expect(
      sourceDepositContinuationAction(
        {
          id: 'deposit',
          status: 'failed',
          transactionHash: `0x${'e'.repeat(64)}`,
          canRetry: false,
        } as never,
        undefined,
        undefined,
      ),
    ).toBe('recovery_required');
    expect(
      sourceDepositContinuationAction(
        { id: 'deposit', status: 'failed', canRetry: true } as never,
        undefined,
        undefined,
      ),
    ).toBe('replace');
  });

  it('locks a new destination operation after delivery has started', () => {
    expect(canStartDestinationOperation('ready_to_sign')).toBe(true);
    expect(canStartDestinationOperation('awaiting_signature')).toBe(true);
    expect(canStartDestinationOperation('source_submitted')).toBe(false);
    expect(canStartDestinationOperation('destination_submitted')).toBe(false);
    expect(canStartDestinationOperation('delivery_pending')).toBe(false);
    expect(canStartDestinationOperation('verifying_destination')).toBe(false);
    expect(canStartDestinationOperation('sync_failed')).toBe(false);
    expect(fundingRecoveryAction('delivery_pending')).toBe('Continue delivery');
    expect(fundingRecoveryAction('source_submitted')).toBe('Check delivery recovery');
    expect(fundingSourceSubmittedRecoveryMessage('send')).toContain('never submit another Send');
    expect(fundingSourceSubmittedRecoveryMessage('bridge')).toContain('original in-memory BridgeResult');
    expect(fundingSourceSubmittedRecoveryMessage('unified_balance')).toContain(
      'does not expose a documented retrySpend',
    );
    expect(fundingContinuationAction('source_submitted', false)).toBe(
      'recovery_required',
    );
    expect(fundingContinuationAction('source_submitted', true)).toBe('retry_bridge');
    expect(fundingContinuationAction('delivery_pending', false)).toBe('reconcile');
    expect(fundingSubmissionFailurePhase(true)).toBe('source_submitted');
    expect(fundingContinuationAction(fundingSubmissionFailurePhase(true), false)).toBe(
      'recovery_required',
    );
    expect(fundingRecoveryAction('sync_failed')).toBe('Retry sync');
  });

  it('never invokes a wallet transaction without a server-verified funding intent', async () => {
    const execute = vi.fn<FundingExecutionAdapter['execute']>();
    const selection = validateFundingSelection('10', [
      source('arc', 'Arc_Testnet', '10'),
    ]).selection;
    expect(selection).toBeDefined();

    await expect(
      executeVerifiedFundingIntent(
        undefined,
        selection!,
        '0x1111111111111111111111111111111111111111',
        { available: true, execute },
        vi.fn(),
      ),
    ).rejects.toThrow('server-verified funding intent');
    expect(execute).not.toHaveBeenCalled();
  });
});
