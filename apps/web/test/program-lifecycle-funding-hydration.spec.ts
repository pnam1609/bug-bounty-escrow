import type { FundingIntent, Program } from '@bug-bounty-escrow/shared';
import { KitError } from '@circle-fin/app-kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface FundingAllocationsProbeProps {
  readonly working: boolean;
  readonly canSubmit: boolean;
  readonly readinessChecked: boolean;
  readonly onConnectWallet: () => void;
  readonly walletPickerOpen?: boolean;
  readonly walletChoices?: readonly { readonly id: string; readonly name: string }[];
  readonly onSelectWallet?: (wallet: unknown) => void;
  readonly onGrossAmountChange: (value: string) => void;
  readonly onSourceChange: (rowId: string, patch: Readonly<Record<string, string>>) => void;
  readonly onAddSource: () => void;
  readonly onCheckReadiness: () => void;
  readonly onSubmit: () => void;
}

const mocks = vi.hoisted(() => ({
  connectCircleWallet: vi.fn(),
  discoverEvmWallets: vi.fn(),
  fundingAllocations: vi.fn((props: FundingAllocationsProbeProps) =>
    createElement('div', {
      'data-testid': 'funding-allocations',
      'data-working': String(props.working),
    }),
  ),
  fundingPending: vi.fn(
    (props: {
      readonly phase: string;
      readonly walletAddress?: string;
      readonly walletMatchesIntent: boolean;
      readonly onConnectWallet: () => void;
      readonly onContinue: () => void;
      readonly onBack: () => void;
      readonly error?: string;
    }) =>
      createElement('div', {
        'data-testid': 'funding-pending',
        'data-phase': props.phase,
        'data-wallet': props.walletAddress ?? 'disconnected',
        'data-wallet-matches': String(props.walletMatchesIntent),
      }),
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    readonly children: ReactNode;
    readonly href: string;
    readonly [key: string]: unknown;
  }) => createElement('a', { ...props, href }, children),
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuth: () => ({
    session: {
      access_token: 'owner-access-token',
      user: { id: '30000000-0000-4000-8000-000000000001' },
    },
  }),
}));

vi.mock('@/components/owner/circle-funding-executor', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/components/owner/circle-funding-executor')>();
  return {
    ...original,
    connectCircleWallet: mocks.connectCircleWallet,
    discoverEvmWallets: mocks.discoverEvmWallets,
  };
});

vi.mock('@/components/owner/program-funding-views', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('@/components/owner/program-funding-views')>();
  return {
    ...original,
    FundingAllocations: mocks.fundingAllocations,
    FundingPending: mocks.fundingPending,
  };
});

import { CircleBridgeIncompleteError } from '@/components/owner/circle-funding-executor';
import { ProgramLifecycle, depositStatusesFromIntent } from '@/components/owner/program-lifecycle';

const PROGRAM_ID = '31000000-0000-4000-8000-000000000002';
const INTENT_ID = '31000000-0000-4000-8000-000000000003';
const WALLET = '0x1111111111111111111111111111111111111111';
const ESCROW = '0x2222222222222222222222222222222222222222';
const TRANSACTION_HASH = `0x${'a'.repeat(64)}`;

function program(): Program {
  return {
    id: PROGRAM_ID,
    ownerId: '30000000-0000-4000-8000-000000000001',
    name: 'Lifecycle hydration',
    slug: 'lifecycle-hydration',
    shortSummary: 'Lifecycle funding hydration regression.',
    description: 'Lifecycle funding hydration regression.',
    status: 'awaiting_funding',
    publicStatus: null,
    tags: [],
    totalPool: '0',
    reservedPool: '0',
    remainingPool: '0',
    totalPaid: null,
    totalPaidVisibility: 'private',
    paidReportCount: null,
    maxBounty: '10',
    inScopeAssetTypes: [],
    rewardSeverities: [],
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    contractAddress: ESCROW,
    scopes: [],
    impacts: [],
    rewardTiers: [],
    resources: [],
    rules: {
      pocPolicy: 'required',
      rewardPolicy: 'Verified funding only.',
      allowCustomImpact: false,
      prohibitedActivities: [],
    },
    metrics: { totalAssetsInScope: 0, medianResolutionSeconds: null },
  };
}

function intent(
  routeMode: FundingIntent['routeMode'],
  status: FundingIntent['status'],
  fundingPhase: FundingIntent['fundingPhase'],
): FundingIntent {
  const sources =
    routeMode === 'send'
      ? [{ network: 'Arc_Testnet' as const, amount: '10' }]
      : routeMode === 'bridge'
        ? [{ network: 'Base_Sepolia' as const, amount: '10' }]
        : [
            { network: 'Arc_Testnet' as const, amount: '4' },
            { network: 'Base_Sepolia' as const, amount: '6' },
          ];
  return {
    id: INTENT_ID,
    programId: PROGRAM_ID,
    walletAddress: WALLET,
    routeMode,
    grossAmount: '10',
    estimatedFeeReserve: '0',
    feeAllocations: sources.map(({ network }) => ({
      network,
      amount: '0',
      components: [
        { network, type: 'provider' as const, token: 'USDC' as const, amount: '0' },
        { network, type: 'gas' as const, token: 'USDC' as const, amount: '0' },
        { network, type: 'kit' as const, token: 'USDC' as const, amount: '0' },
        { network, type: 'forwarder' as const, token: 'USDC' as const, amount: '0' },
      ],
    })),
    quoteQuotedAt: '2026-07-29T00:00:00.000Z',
    quoteExpiresAt: '2026-07-29T01:00:00.000Z',
    sources,
    sourceDeposits: [],
    fundingPhase,
    destinationChain: 'Arc_Testnet',
    recipientAddress: ESCROW,
    recipientVerified: true,
    status,
    expiresAt: '2026-07-29T01:30:00.000Z',
    ...([
      'destination_submitted',
      'delivery_pending',
      'verifying_destination',
      'syncing_pool',
    ].includes(status)
      ? { destinationTransactionHash: TRANSACTION_HASH }
      : {}),
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
  };
}

function latestFundingAllocationsProps(): FundingAllocationsProbeProps {
  const props = mocks.fundingAllocations.mock.lastCall?.[0];
  if (props === undefined) throw new Error('Funding allocations were not rendered.');
  return props;
}

function latestFundingPendingProps() {
  const props = mocks.fundingPending.mock.lastCall?.[0];
  if (props === undefined) throw new Error('Funding pending was not rendered.');
  return props;
}

async function renderLifecycle(
  fetchImplementation: (input: string | URL | Request) => Promise<Response>,
): Promise<ReactTestRenderer> {
  vi.stubGlobal('fetch', vi.fn(fetchImplementation));

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ProgramLifecycle, {
          program: program(),
          showCreatedBanner: false,
          logoFailed: false,
          onBlockingPendingChange: vi.fn(),
          onEditProgram: vi.fn(),
        }),
      ),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  if (renderer === undefined) throw new Error('Lifecycle renderer was not created.');
  return renderer;
}

async function renderWithActiveIntent(activeIntent: FundingIntent): Promise<ReactTestRenderer> {
  return renderLifecycle(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents/active`)) {
      return new Response(JSON.stringify({ success: true, data: activeIntent }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith(`/funding-intents/${INTENT_ID}/gateway-readiness`)) {
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            intentId: INTENT_ID,
            ready: true,
            requiredConfirmedTotal: '10',
            confirmedSelectedTotal: '10',
            sources: activeIntent.sources.map((source) => ({
              network: source.network,
              hasFeeHeadroom: false,
              allocation: source.amount,
              feeReserve: '0',
              requiredConfirmed: source.amount,
              confirmed: source.amount,
              deficit: '0',
            })),
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.endsWith(`/api/programs/${PROGRAM_ID}/withdrawal-intents/active`)) {
      return new Response(
        JSON.stringify({
          success: false,
          error: { code: 'not_found', message: 'No active withdrawal.' },
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected lifecycle request: ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  process.env['NEXT_PUBLIC_API_BASE_URL'] = 'http://localhost:3001';
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost:54321';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'test-anon-key';
  process.env['NEXT_PUBLIC_ARC_RPC_URL'] = 'http://localhost:8545';
  process.env['NEXT_PUBLIC_ARC_EXPLORER_URL'] = 'http://localhost:4000';
  process.env['NEXT_PUBLIC_ARC_CHAIN_ID'] = '5042002';
  process.env['NEXT_PUBLIC_USDC_ADDRESS'] = '0x3333333333333333333333333333333333333333';
  mocks.connectCircleWallet.mockReset();
  mocks.discoverEvmWallets.mockReset();
  mocks.fundingAllocations.mockClear();
  mocks.fundingPending.mockClear();
});

describe('ProgramLifecycle durable CP-12 hydration', () => {
  it('opens the provider chooser for Change wallet and connects the selected provider', async () => {
    const walletA = {
      id: 'rainbow',
      name: 'Rainbow',
      rdns: 'me.rainbow',
      provider: {},
    };
    const walletB = {
      id: 'metamask',
      name: 'MetaMask',
      rdns: 'io.metamask',
      provider: {},
    };
    mocks.connectCircleWallet.mockResolvedValue({
      address: WALLET,
      wallet: walletA,
      executor: {},
    });
    mocks.discoverEvmWallets.mockResolvedValue([walletA, walletB]);

    const renderer = await renderLifecycle(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents/active`)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'not_found', message: 'No active funding intent.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/withdrawal-intents/active`)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'not_found', message: 'No active withdrawal.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected lifecycle request: ${String(input)}`);
    });

    const fundButton = renderer.root
      .findAll(
        (node) =>
          node.props['children'] === 'Fund rewards' && typeof node.props['onClick'] === 'function',
      )
      .at(-1);
    if (fundButton === undefined) throw new Error('Fund rewards action was not rendered.');
    await act(async () => fundButton.props['onClick']());

    let allocations = latestFundingAllocationsProps();
    await act(async () => allocations.onConnectWallet());
    expect(mocks.connectCircleWallet).toHaveBeenCalledOnce();

    allocations = latestFundingAllocationsProps();
    await act(async () => allocations.onConnectWallet());
    allocations = latestFundingAllocationsProps();
    expect(mocks.discoverEvmWallets).toHaveBeenCalledOnce();
    expect(allocations.walletPickerOpen).toBe(true);
    expect(allocations.walletChoices?.map((wallet) => wallet.id)).toEqual(['rainbow', 'metamask']);

    await act(async () => allocations.onSelectWallet?.(walletB));
    allocations = latestFundingAllocationsProps();
    expect(mocks.connectCircleWallet).toHaveBeenNthCalledWith(2, walletB);
    expect(allocations.walletPickerOpen).toBe(false);

    await act(async () => renderer.unmount());
  });

  it('releases an explicit rejected Send and reloads the same signature attempt', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const operationRecordId = '31000000-0000-4000-8000-000000000090';
    const baseIntent = {
      ...intent('send', 'ready_to_sign', 'ready_for_destination'),
      quoteExpiresAt: '2099-07-29T01:00:00.000Z',
    };
    const claimedIntent = {
      ...baseIntent,
      status: 'awaiting_signature' as const,
      recovery: {
        operationRecordId,
        operationType: 'send' as const,
        attemptNo: 1,
        status: 'awaiting_signature' as const,
        retryable: true,
        submissionUncertain: false,
        sourceTransactionHashes: [],
        steps: [{ name: 'wallet_signature', state: 'pending' as const }],
      },
    };
    const uncertainIntent = {
      ...claimedIntent,
      status: 'source_submitted' as const,
      recovery: {
        ...claimedIntent.recovery,
        status: 'submission_uncertain' as const,
        submissionUncertain: true,
      },
    };
    const execute = vi.fn(
      async (_request: unknown, onPhase: (phase: 'awaiting_signature') => Promise<void>) => {
        await onPhase('awaiting_signature');
        throw { code: 4001 };
      },
    );
    mocks.connectCircleWallet.mockResolvedValue({
      address: WALLET,
      wallet: { id: 'test-wallet', name: 'Test wallet', provider: {} },
      executor: { execute },
    });
    const endpointCalls: string[] = [];
    const renderer = await renderLifecycle(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      endpointCalls.push(path);
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents/active`)) {
        return new Response(JSON.stringify({ success: true, data: baseIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/destination-attempts`)) {
        return new Response(JSON.stringify({ success: true, data: claimedIntent }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/destination-attempts/arm`)) {
        return new Response(JSON.stringify({ success: true, data: claimedIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/operations`)) {
        return new Response(JSON.stringify({ success: true, data: uncertainIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/destination-attempts/rejected`)) {
        return new Response(JSON.stringify({ success: true, data: claimedIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/withdrawal-intents/active`)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'not_found', message: 'No active withdrawal.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected lifecycle request: ${String(input)}`);
    });

    let pending = latestFundingPendingProps();
    await act(async () => pending.onConnectWallet());
    pending = latestFundingPendingProps();
    expect(mocks.connectCircleWallet).toHaveBeenCalledOnce();
    expect(pending.walletAddress).toBe(WALLET);
    await act(async () => pending.onContinue());

    expect(latestFundingPendingProps().error).toContain('rejected before broadcast');
    expect(execute, JSON.stringify(endpointCalls)).toHaveBeenCalledOnce();
    expect(latestFundingPendingProps().phase).toBe('awaiting_signature');
    expect(
      endpointCalls.filter((path) => path.endsWith('/destination-attempts/rejected')),
    ).toHaveLength(1);
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it('atomically cancels a UB handoff on Back only when no irreversible evidence exists', async () => {
    const activeIntent = intent('unified_balance', 'ready_to_sign', 'ready_for_destination');
    const cancelledIntent = { ...activeIntent, status: 'cancelled' as const };
    const calls: string[] = [];
    const renderer = await renderLifecycle(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents/active`)) {
        return new Response(JSON.stringify({ success: true, data: activeIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/gateway-readiness`)) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              intentId: INTENT_ID,
              ready: true,
              requiredConfirmedTotal: '10',
              confirmedSelectedTotal: '10',
              sources: activeIntent.sources.map((source) => ({
                network: source.network,
                hasFeeHeadroom: false,
                allocation: source.amount,
                feeReserve: '0',
                requiredConfirmed: source.amount,
                confirmed: source.amount,
                deficit: '0',
              })),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/cancel`)) {
        return new Response(JSON.stringify({ success: true, data: cancelledIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/withdrawal-intents/active`)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'not_found', message: 'No active withdrawal.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected lifecycle request: ${String(input)}`);
    });

    await act(async () => latestFundingPendingProps().onBack());
    expect(
      calls.filter((path) => path.endsWith(`/funding-intents/${INTENT_ID}/cancel`)),
    ).toHaveLength(1);
    expect(renderer.root.findByProps({ 'data-testid': 'funding-allocations' })).toBeDefined();
    await act(async () => renderer.unmount());
  });

  it('derives a fresh-quote top-up without mutating confirmed deposit evidence', () => {
    const confirmedIntent = {
      ...intent('unified_balance', 'ready_to_sign', 'collecting_deposits'),
      sourceDeposits: [
        {
          id: '31000000-0000-4000-8000-000000000004',
          attemptNo: 1,
          network: 'Base_Sepolia' as const,
          chainId: 84_532,
          tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
          gatewayWalletAddress: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
          walletAddress: WALLET,
          amount: '6',
          preGatewayBalance: '0',
          status: 'confirmed' as const,
          transactionHash: TRANSACTION_HASH,
          logIndex: 1,
          blockNumber: '10',
          blockHash: `0x${'b'.repeat(64)}`,
          canAttach: true as const,
          canRetry: false,
          createdAt: '2026-07-29T00:00:00.000Z',
          updatedAt: '2026-07-29T00:10:00.000Z',
        },
      ],
    };
    const sources = confirmedIntent.sources.map((source, index) => ({
      ...source,
      rowId: `source-${index + 1}`,
    }));
    const readiness = {
      intentId: INTENT_ID,
      ready: false,
      requiredConfirmedTotal: '10.1',
      confirmedSelectedTotal: '10',
      sources: [
        {
          network: 'Arc_Testnet' as const,
          hasFeeHeadroom: false,
          allocation: '4',
          feeReserve: '0',
          requiredConfirmed: '4',
          confirmed: '4',
          deficit: '0',
        },
        {
          network: 'Base_Sepolia' as const,
          hasFeeHeadroom: true,
          allocation: '6',
          feeReserve: '0.1',
          requiredConfirmed: '6.1',
          confirmed: '6',
          deficit: '0.1',
        },
      ],
    };

    expect(depositStatusesFromIntent(confirmedIntent, sources, readiness)).toEqual({
      'source-1': 'not_started',
      'source-2': 'top_up_required',
    });
    expect(confirmedIntent.sourceDeposits[0]?.amount).toBe('6');
    expect(confirmedIntent.sourceDeposits[0]?.transactionHash).toBe(TRANSACTION_HASH);
  });

  it('never replays a Bridge wallet call after an armed/crashed operation reload', async () => {
    const activeIntent = intent('bridge', 'source_submitted', 'ready_for_destination');
    const execute = vi.fn();
    mocks.connectCircleWallet.mockResolvedValue({
      address: WALLET,
      wallet: { id: 'test-wallet', name: 'Test wallet', provider: {} },
      executor: { execute },
    });
    const renderer = await renderLifecycle(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      if (
        path.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents/active`) ||
        path.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents/${INTENT_ID}`)
      ) {
        return new Response(JSON.stringify({ success: true, data: activeIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/withdrawal-intents/active`)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'not_found', message: 'No active withdrawal.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected lifecycle request: ${String(input)}`);
    });
    let pending = latestFundingPendingProps();
    await act(async () => pending.onConnectWallet());
    pending = latestFundingPendingProps();
    await act(async () => pending.onContinue());
    expect(execute).not.toHaveBeenCalled();
    expect(latestFundingPendingProps().phase).toBe('source_submitted');
    await act(async () => renderer.unmount());
  });

  it('retries one initial incomplete Bridge once, then locks an accepted-but-lost retry', async () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const operationRecordId = '31000000-0000-4000-8000-000000000090';
    const burnHash = `0x${'b'.repeat(64)}`;
    const retryableError = new KitError({
      code: 3002,
      name: 'NETWORK_TIMEOUT',
      type: 'NETWORK',
      recoverability: 'RETRYABLE',
      message: 'temporary delivery failure',
    });
    const incompleteResult = {
      state: 'error',
      steps: [
        { name: 'Burn', state: 'success', txHash: burnHash },
        {
          name: 'Mint',
          state: 'error',
          error: retryableError,
          errorCategory: 'failed_offchain',
        },
      ],
    } as never;
    const baseIntent: FundingIntent = {
      ...intent('bridge', 'ready_to_sign', 'ready_for_destination'),
      quoteExpiresAt: '2099-07-29T01:00:00.000Z',
      expiresAt: '2099-07-29T01:30:00.000Z',
    };
    const claimedIntent: FundingIntent = {
      ...baseIntent,
      status: 'awaiting_signature',
      recovery: {
        operationRecordId,
        operationType: 'bridge',
        attemptNo: 1,
        status: 'awaiting_signature',
        retryable: true,
        submissionUncertain: false,
        sourceTransactionHashes: [],
        steps: [{ name: 'wallet_signature', state: 'pending' }],
      },
    };
    const armedIntent: FundingIntent = {
      ...claimedIntent,
      status: 'source_submitted',
      recovery: {
        ...claimedIntent.recovery!,
        status: 'submission_uncertain',
        retryable: false,
        submissionUncertain: true,
      },
    };
    const pendingIntent: FundingIntent = {
      ...claimedIntent,
      status: 'source_submitted',
      recovery: {
        ...claimedIntent.recovery!,
        status: 'pending',
        providerState: 'error',
        retryable: true,
        submissionUncertain: false,
        sourceTransactionHashes: [burnHash],
        steps: [
          { name: 'Burn', state: 'success', transactionHash: burnHash },
          { name: 'Mint', state: 'error', errorCode: 'failed_offchain' },
        ],
      },
    };
    const execute = vi.fn(
      async (_request: unknown, onPhase: (phase: 'awaiting_signature') => Promise<void>) => {
        await onPhase('awaiting_signature');
        throw new CircleBridgeIncompleteError(incompleteResult);
      },
    );
    const retrySdk = vi.fn(async () => {
      throw new Error('response lost after accepted delivery retry');
    });
    let retryAttempt = 0;
    const retryBridge = vi.fn(
      async (_result: unknown, onPhase: (phase: 'delivery_pending') => void | Promise<void>) => {
        retryAttempt += 1;
        if (retryAttempt === 1) {
          throw new Error('The active wallet account changed. Reconnect before continuing.');
        }
        await onPhase('delivery_pending');
        return retrySdk();
      },
    );
    mocks.connectCircleWallet.mockResolvedValue({
      address: WALLET,
      wallet: { id: 'test-wallet', name: 'Test wallet', provider: {} },
      executor: { execute, retryBridge },
    });
    const calls: string[] = [];
    const renderer = await renderLifecycle(async (input: string | URL | Request) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents/active`)) {
        return new Response(JSON.stringify({ success: true, data: baseIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/destination-attempts`)) {
        return new Response(JSON.stringify({ success: true, data: claimedIntent }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/destination-attempts/delivery-retry/arm`)) {
        return new Response(JSON.stringify({ success: true, data: armedIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/destination-attempts/arm`)) {
        return new Response(JSON.stringify({ success: true, data: armedIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/operations`)) {
        return new Response(JSON.stringify({ success: true, data: pendingIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}`)) {
        return new Response(JSON.stringify({ success: true, data: pendingIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/withdrawal-intents/active`)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'not_found', message: 'No active withdrawal.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected lifecycle request: ${String(input)}`);
    });

    let pending = latestFundingPendingProps();
    await act(async () => pending.onConnectWallet());
    pending = latestFundingPendingProps();
    await act(async () => pending.onContinue());
    expect(
      execute,
      JSON.stringify({ calls, error: latestFundingPendingProps().error }),
    ).toHaveBeenCalledOnce();
    expect(retryBridge).not.toHaveBeenCalled();
    expect(latestFundingPendingProps().error).toContain('Continue delivery retries');

    await act(async () => latestFundingPendingProps().onContinue());
    expect(retryBridge).toHaveBeenCalledOnce();
    expect(retrySdk).not.toHaveBeenCalled();
    expect(latestFundingPendingProps().error).toContain('active wallet account changed');
    expect(
      calls.filter((path) => path.endsWith('/destination-attempts/delivery-retry/arm')),
    ).toHaveLength(0);

    await act(async () => latestFundingPendingProps().onContinue());
    expect(retryBridge).toHaveBeenCalledTimes(2);
    expect(retrySdk).toHaveBeenCalledOnce();
    expect(latestFundingPendingProps().error).toContain(
      'response lost after accepted delivery retry',
    );

    await act(async () => latestFundingPendingProps().onContinue());
    expect(retryBridge).toHaveBeenCalledTimes(2);
    expect(retrySdk).toHaveBeenCalledOnce();
    expect(
      calls.filter((path) => path.endsWith('/destination-attempts/delivery-retry/arm')),
    ).toHaveLength(1);
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it('replays a persisted Unified Balance source hash with its exact network after reload', async () => {
    const sourceHash = `0x${'6'.repeat(64)}`;
    const destinationHash = `0x${'7'.repeat(64)}`;
    const operationRecordId = '31000000-0000-4000-8000-000000000091';
    const activeIntent: FundingIntent = {
      ...intent('unified_balance', 'source_submitted', 'ready_for_destination'),
      recovery: {
        operationRecordId,
        operationType: 'spend',
        attemptNo: 1,
        status: 'submission_uncertain',
        providerState: 'pending',
        retryable: false,
        submissionUncertain: true,
        sourceTransactionHashes: [],
        steps: [{ name: 'wallet_signature', state: 'pending' }],
      },
    };
    const attachedIntent: FundingIntent = {
      ...activeIntent,
      status: 'destination_submitted',
      destinationTransactionHash: destinationHash,
      recovery: {
        ...activeIntent.recovery!,
        status: 'submitted',
        transactionHash: destinationHash,
        submissionUncertain: false,
      },
    };
    const telemetryIntent: FundingIntent = {
      ...attachedIntent,
      status: 'delivery_pending',
      recovery: {
        ...attachedIntent.recovery!,
        status: 'pending',
        sourceTransactionHashes: [sourceHash],
        steps: [
          {
            name: 'source_transaction',
            state: 'success',
            network: 'Base_Sepolia',
            transactionHash: sourceHash,
          },
        ],
      },
    };
    const storage = new Map<string, string>([
      [
        `bounty-escrow:funding:${PROGRAM_ID}:${INTENT_ID}:destination`,
        JSON.stringify({
          routeMode: 'unified_balance',
          destinationTransactionHash: destinationHash,
          sourceTransactionHashes: [sourceHash],
          sourceTransactions: [{ network: 'Base_Sepolia', transactionHash: sourceHash }],
        }),
      ],
    ]);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
    });
    const execute = vi.fn();
    mocks.connectCircleWallet.mockResolvedValue({
      address: WALLET,
      wallet: { id: 'test-wallet', name: 'Test wallet', provider: {} },
      executor: { execute },
    });
    let recoveryTelemetryBody: unknown;
    const renderer = await renderLifecycle(
      async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents/active`)) {
          return new Response(JSON.stringify({ success: true, data: activeIntent }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (path.endsWith(`/destination-attempts/attach`)) {
          return new Response(JSON.stringify({ success: true, data: attachedIntent }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (path.endsWith(`/destination-attempts/recovery-telemetry`)) {
          recoveryTelemetryBody = JSON.parse(String(init?.body));
          return new Response(JSON.stringify({ success: true, data: telemetryIntent }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (path.endsWith(`/funding-intents/${INTENT_ID}/reconcile`)) {
          return new Response(JSON.stringify({ success: true, data: telemetryIntent }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (path.endsWith(`/api/programs/${PROGRAM_ID}/withdrawal-intents/active`)) {
          return new Response(
            JSON.stringify({
              success: false,
              error: { code: 'not_found', message: 'No active withdrawal.' },
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
        throw new Error(`Unexpected lifecycle request: ${String(input)}`);
      },
    );

    await act(async () => latestFundingPendingProps().onConnectWallet());
    await act(async () => latestFundingPendingProps().onContinue());
    expect(execute).not.toHaveBeenCalled();
    expect(recoveryTelemetryBody).toMatchObject({
      sourceTransactionHashes: [sourceHash],
      steps: [
        {
          name: 'source_transaction',
          state: 'success',
          network: 'Base_Sepolia',
          transactionHash: sourceHash,
        },
      ],
    });
    await act(async () => renderer.unmount());
    vi.unstubAllGlobals();
  });

  it.each([
    ['send', 'ready_to_sign'],
    ['bridge', 'source_submitted'],
    ['unified_balance', 'delivery_pending'],
  ] as const)(
    'restores %s/%s directly into CP-12 while disconnected without prompting the wallet',
    async (routeMode, status) => {
      const renderer = await renderWithActiveIntent(
        intent(routeMode, status, 'ready_for_destination'),
      );

      const pending = renderer.root.findByProps({ 'data-testid': 'funding-pending' });
      expect(pending.props['data-phase']).toBe(status);
      expect(pending.props['data-wallet']).toBe('disconnected');
      expect(mocks.connectCircleWallet).not.toHaveBeenCalled();
      expect(mocks.fundingAllocations).not.toHaveBeenCalled();

      await act(async () => renderer.unmount());
    },
  );

  it('keeps the first Unified Balance submission in CP-11 until durable handoff is prepared', async () => {
    const renderer = await renderWithActiveIntent(
      intent('unified_balance', 'ready_to_sign', 'collecting_deposits'),
    );

    expect(renderer.root.findByProps({ 'data-testid': 'funding-allocations' })).toBeDefined();
    expect(mocks.fundingPending).not.toHaveBeenCalled();
    expect(mocks.connectCircleWallet).not.toHaveBeenCalled();

    await act(async () => renderer.unmount());
  });

  it('restores the second-submit Unified Balance handoff in CP-12 after reload', async () => {
    const renderer = await renderWithActiveIntent(
      intent('unified_balance', 'ready_to_sign', 'ready_for_destination'),
    );

    expect(renderer.root.findByProps({ 'data-testid': 'funding-pending' })).toBeDefined();
    expect(mocks.connectCircleWallet).not.toHaveBeenCalled();

    await act(async () => renderer.unmount());
  });

  it('locks the first sufficient-balance Unified Balance submit in CP-11 and prepares CP-12 only on the second submit', async () => {
    const quote = {
      estimatedFeeReserve: '0',
      estimatedFeeReserveBaseUnits: 0n,
      estimatedFeeReserveByNetwork: {
        Arc_Testnet: '0',
        Base_Sepolia: '0',
      },
      feeAllocations: [
        {
          network: 'Arc_Testnet' as const,
          amount: '0',
          components: [
            {
              network: 'Arc_Testnet' as const,
              type: 'provider' as const,
              token: 'USDC' as const,
              amount: '0',
            },
            {
              network: 'Arc_Testnet' as const,
              type: 'gas' as const,
              token: 'USDC' as const,
              amount: '0',
            },
            {
              network: 'Arc_Testnet' as const,
              type: 'kit' as const,
              token: 'USDC' as const,
              amount: '0',
            },
            {
              network: 'Arc_Testnet' as const,
              type: 'forwarder' as const,
              token: 'USDC' as const,
              amount: '0',
            },
          ],
        },
        {
          network: 'Base_Sepolia' as const,
          amount: '0',
          components: [
            {
              network: 'Base_Sepolia' as const,
              type: 'provider' as const,
              token: 'USDC' as const,
              amount: '0',
            },
            {
              network: 'Base_Sepolia' as const,
              type: 'gas' as const,
              token: 'USDC' as const,
              amount: '0',
            },
            {
              network: 'Base_Sepolia' as const,
              type: 'kit' as const,
              token: 'USDC' as const,
              amount: '0',
            },
            {
              network: 'Base_Sepolia' as const,
              type: 'forwarder' as const,
              token: 'USDC' as const,
              amount: '0',
            },
          ],
        },
      ],
      quotedAt: '2026-07-29T00:00:00.000Z',
      expiresAt: '2099-07-29T01:00:00.000Z',
    };
    const executor = {
      estimateFunding: vi.fn(async () => quote),
      getUnifiedBalance: vi.fn(async () => ({
        confirmedAmount: '10',
        pendingAmount: '0',
        confirmedByNetwork: {
          Arc_Testnet: '4',
          Base_Sepolia: '6',
        },
        pendingByNetwork: {
          Arc_Testnet: '0',
          Base_Sepolia: '0',
        },
      })),
    };
    mocks.connectCircleWallet.mockResolvedValue({
      address: WALLET,
      wallet: { id: 'test-wallet', name: 'Test wallet', provider: {} },
      executor,
    });

    const collectingIntent = intent('unified_balance', 'ready_to_sign', 'collecting_deposits');
    const preparedIntent = {
      ...collectingIntent,
      fundingPhase: 'ready_for_destination' as const,
    };
    const endpointCalls: string[] = [];
    const renderer = await renderLifecycle(async (input: string | URL | Request) => {
      const url = String(input);
      const path = new URL(url).pathname;
      endpointCalls.push(path);
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents/active`)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'not_found', message: 'No active funding intent.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (path.endsWith(`/api/programs/${PROGRAM_ID}/withdrawal-intents/active`)) {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'not_found', message: 'No active withdrawal.' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (
        path.endsWith(`/api/programs/${PROGRAM_ID}/funding-intents`) &&
        !path.includes('/gateway-readiness')
      ) {
        return new Response(JSON.stringify({ success: true, data: collectingIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/quote`)) {
        return new Response(JSON.stringify({ success: true, data: collectingIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/gateway-readiness`)) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              intentId: INTENT_ID,
              ready: true,
              requiredConfirmedTotal: '10',
              confirmedSelectedTotal: '10',
              sources: [
                {
                  network: 'Arc_Testnet',
                  hasFeeHeadroom: true,
                  allocation: '4',
                  feeReserve: '0',
                  requiredConfirmed: '4',
                  confirmed: '4',
                  deficit: '0',
                },
                {
                  network: 'Base_Sepolia',
                  hasFeeHeadroom: true,
                  allocation: '6',
                  feeReserve: '0',
                  requiredConfirmed: '6',
                  confirmed: '6',
                  deficit: '0',
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (path.endsWith(`/funding-intents/${INTENT_ID}/prepare-destination`)) {
        return new Response(JSON.stringify({ success: true, data: preparedIntent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`Unexpected lifecycle request: ${url}`);
    });

    const fundButton = renderer.root
      .findAll(
        (node) =>
          node.props['children'] === 'Fund rewards' && typeof node.props['onClick'] === 'function',
      )
      .at(-1);
    if (fundButton === undefined) throw new Error('Fund rewards action was not rendered.');
    await act(async () => fundButton.props['onClick']());

    let allocationsProps = latestFundingAllocationsProps();
    await act(async () => allocationsProps.onConnectWallet());
    await act(async () => {
      allocationsProps.onGrossAmountChange('10');
      allocationsProps.onSourceChange('source-1', {
        network: 'Arc_Testnet',
        amount: '4',
      });
      allocationsProps.onAddSource();
    });
    allocationsProps = latestFundingAllocationsProps();
    await act(async () =>
      allocationsProps.onSourceChange('source-2', {
        network: 'Base_Sepolia',
        amount: '6',
      }),
    );

    allocationsProps = latestFundingAllocationsProps();
    await act(async () => allocationsProps.onCheckReadiness());
    allocationsProps = latestFundingAllocationsProps();
    expect(allocationsProps.readinessChecked).toBe(true);
    expect(allocationsProps.canSubmit).toBe(true);
    await act(async () => allocationsProps.onSubmit());

    expect(renderer.root.findByProps({ 'data-testid': 'funding-allocations' })).toBeDefined();
    expect(endpointCalls.filter((path) => path.endsWith('/prepare-destination'))).toHaveLength(0);
    expect(executor.getUnifiedBalance).not.toHaveBeenCalled();
    expect(executor.estimateFunding).toHaveBeenCalledTimes(1);

    allocationsProps = latestFundingAllocationsProps();
    await act(async () => allocationsProps.onCheckReadiness());
    allocationsProps = latestFundingAllocationsProps();
    expect(allocationsProps.readinessChecked).toBe(true);
    expect(allocationsProps.canSubmit).toBe(true);
    await act(async () => allocationsProps.onSubmit());

    expect(endpointCalls.filter((path) => path.endsWith('/prepare-destination'))).toHaveLength(1);
    expect(renderer.root.findByProps({ 'data-testid': 'funding-pending' })).toBeDefined();
    expect(executor.getUnifiedBalance).toHaveBeenCalledTimes(1);
    expect(executor.estimateFunding).toHaveBeenCalledTimes(2);

    await act(async () => renderer.unmount());
  });
});
