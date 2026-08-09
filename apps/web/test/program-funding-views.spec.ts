import type { Program } from '@bug-bounty-escrow/shared';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const rainbowState = vi.hoisted(() => ({ connected: false }));

vi.mock('@rainbow-me/rainbowkit', async (importOriginal) => {
  const original = await importOriginal<typeof import('@rainbow-me/rainbowkit')>();
  return {
    ...original,
    ConnectButton: {
      Custom: ({
        children,
      }: {
        readonly children: (props: {
          readonly account: { readonly address: string; readonly displayName: string } | undefined;
          readonly chain: { readonly unsupported?: boolean } | undefined;
          readonly mounted: true;
          readonly openAccountModal: () => void;
          readonly openChainModal: () => void;
          readonly openConnectModal: () => void;
        }) => ReactNode;
      }) =>
        children({
          account: rainbowState.connected
            ? {
                address: WALLET,
                displayName: '0x1111…1111',
              }
            : undefined,
          chain: rainbowState.connected ? { unsupported: false } : undefined,
          mounted: true,
          openAccountModal: vi.fn(),
          openChainModal: vi.fn(),
          openConnectModal: vi.fn(),
        }),
    },
  };
});

import { FundingAllocations, FundingPending } from '@/components/owner/program-funding-views';
import { RainbowKitFundingButton } from '@/components/owner/rainbowkit-funding-button';
import type {
  FundingSource,
  ValidatedFundingSelection,
  VerifiedFundingIntent,
} from '@/components/owner/program-funding-flow';

const WALLET = '0x1111111111111111111111111111111111111111';
const ESCROW = '0x2222222222222222222222222222222222222222';
const fee = (network: 'Arc_Testnet' | 'Base_Sepolia', amount: string) => ({
  network,
  amount,
  components: [
    { network, type: 'provider' as const, token: 'USDC' as const, amount },
    { network, type: 'gas' as const, token: 'USDC' as const, amount: '0' },
    { network, type: 'kit' as const, token: 'USDC' as const, amount: '0' },
    { network, type: 'forwarder' as const, token: 'USDC' as const, amount: '0' },
  ],
});

const sources: readonly FundingSource[] = [
  { rowId: 'arc', network: 'Arc_Testnet', amount: '4' },
  { rowId: 'base', network: 'Base_Sepolia', amount: '6' },
];

const selection: ValidatedFundingSelection = {
  grossAmount: '10',
  grossBaseUnits: 10_000_000n,
  routeMode: 'unified_balance',
  sources,
};

const intent: VerifiedFundingIntent = {
  id: '31000000-0000-4000-8000-000000000001',
  walletAddress: WALLET,
  routeMode: 'unified_balance',
  fundingPhase: 'ready_for_destination',
  grossAmount: '10',
  estimatedFeeReserve: '0.25',
  feeAllocations: [fee('Arc_Testnet', '0.1'), fee('Base_Sepolia', '0.15')],
  sources,
  sourceDeposits: [],
  destinationChain: 'Arc_Testnet',
  recipientAddress: ESCROW,
  recipientVerified: true,
  destinationTransactionHash: `0x${'a'.repeat(64)}`,
  transferId: 'circle-transfer-id-with-durable-evidence',
  recovery: {
    operationRecordId: '31000000-0000-4000-8000-000000000099',
    operationType: 'bridge',
    status: 'pending',
    operationId: 'circle-operation-id-with-durable-evidence',
    retryable: false,
    submissionUncertain: false,
    sourceTransactionHashes: [`0x${'b'.repeat(64)}`],
    steps: [
      { name: 'buildBurnIntents', state: 'success' },
      { name: 'signBurnIntents', state: 'success', transactionHash: `0x${'b'.repeat(64)}` },
      { name: 'fetchAttestation', state: 'pending' },
      { name: 'mint', state: 'pending' },
    ],
  },
};

function program(): Program {
  return {
    id: '31000000-0000-4000-8000-000000000002',
    ownerId: '30000000-0000-4000-8000-000000000001',
    name: 'Funding UI',
    slug: 'funding-ui',
    shortSummary: 'Funding UI regression fixture.',
    description: 'Funding UI regression fixture.',
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
    escrowAddress: ESCROW,
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

describe('CP-11 and CP-12 funding views', () => {
  it('delegates wallet connect and disconnect UI to RainbowKit', () => {
    rainbowState.connected = false;
    const html = renderToStaticMarkup(
      createElement(FundingAllocations, {
        program: program(),
        grossAmount: '10',
        sources: [{ rowId: 'arc', network: 'Arc_Testnet', amount: '10' }],
        errors: {},
        walletAddress: WALLET,
        walletName: 'MetaMask',
        walletPending: false,
        walletError: undefined,
        depositStatuses: {},
        depositRequiredAmounts: {},
        depositRecoveryHashes: {},
        confirmedUnifiedBalance: undefined,
        pendingUnifiedBalance: undefined,
        estimatedFeeReserve: undefined,
        transactionsEnabled: false,
        canSubmit: false,
        readinessChecked: false,
        working: false,
        onConnectWallet: vi.fn(),
        onDisconnectWallet: vi.fn(),
        onGrossAmountChange: vi.fn(),
        onSourceChange: vi.fn(),
        onAddSource: vi.fn(),
        onRemoveSource: vi.fn(),
        onDepositSource: vi.fn(),
        onDepositRecoveryHashChange: vi.fn(),
        onRefreshUnifiedBalance: vi.fn(),
        onSubmit: vi.fn(),
        onCheckReadiness: vi.fn(),
        onLater: vi.fn(),
      }),
    );

    expect(html).toContain('data-rainbow-state="disconnected"');
    expect(html).toContain('bg-primary');
    expect(html).not.toContain('Change wallet');
    expect(html).not.toContain('Choose a wallet');
  });

  it('uses BBE surface and border tokens for the connected RainbowKit account button', () => {
    rainbowState.connected = true;
    const html = renderToStaticMarkup(createElement(RainbowKitFundingButton));

    expect(html).toContain('data-rainbow-state="connected"');
    expect(html).toContain('data-wallet-address="0x1111111111111111111111111111111111111111"');
    expect(html).toContain('bg-ambient');
    expect(html).toContain('border-border-brand');
    rainbowState.connected = false;
  });

  it('hydrates canonical CP-12 evidence while disconnected without prompting a wallet', () => {
    const connect = vi.fn();
    const html = renderToStaticMarkup(
      createElement(FundingPending, {
        walletAddress: undefined,
        walletMatchesIntent: false,
        intent,
        selection,
        phase: 'source_submitted',
        working: false,
        error: undefined,
        result: undefined,
        executionAvailable: true,
        verifiedRecipient: ESCROW,
        estimatedFeeReserve: '0.25',
        recoveryHash: '',
        onBack: vi.fn(),
        onConnectWallet: connect,
        onContinue: vi.fn(),
        onRecoveryHashChange: vi.fn(),
      }),
    );

    expect(connect).not.toHaveBeenCalled();
    expect(html).toContain('Reconnect the locked funding wallet');
    expect(html).toContain('data-rainbow-state="disconnected"');
    expect(html).toContain('Arc Testnet');
    expect(html).toContain('Base Sepolia');
    expect(html).toContain('9.75 USDC');
    expect(html).toContain('Destination transaction');
    expect(html).toContain('Circle transfer');
    expect(html).toContain('Source transaction 1');
    expect(html).not.toContain('Check deposit');
  });

  it('renders granular Unified Balance progress from bounded server recovery steps', () => {
    const html = renderToStaticMarkup(
      createElement(FundingPending, {
        walletAddress: WALLET,
        walletMatchesIntent: true,
        intent,
        selection,
        phase: 'source_submitted',
        working: false,
        error: undefined,
        result: undefined,
        executionAvailable: true,
        verifiedRecipient: ESCROW,
        estimatedFeeReserve: '0.25',
        recoveryHash: '',
        onBack: vi.fn(),
        onConnectWallet: vi.fn(),
        onContinue: vi.fn(),
        onRecoveryHashChange: vi.fn(),
      }),
    );

    expect(html).toContain('Build Unified Balance burn intents');
    expect(html).toContain('Sign burn intents sequentially');
    expect(html).toContain('Fetch Gateway attestation');
    expect(html).toContain('Mint USDC on Arc');
    expect(html).toContain('Server state: pending');
  });

  it('disables CP-11 Submit while the plan is not ready or is working', () => {
    const html = renderToStaticMarkup(
      createElement(FundingAllocations, {
        program: program(),
        grossAmount: '10',
        sources: [{ rowId: 'arc', network: 'Arc_Testnet', amount: '10' }],
        errors: {},
        walletAddress: WALLET,
        walletName: 'Test wallet',
        walletPending: false,
        walletError: undefined,
        depositStatuses: {},
        depositRequiredAmounts: {},
        depositRecoveryHashes: {},
        confirmedUnifiedBalance: undefined,
        pendingUnifiedBalance: undefined,
        estimatedFeeReserve: undefined,
        transactionsEnabled: false,
        canSubmit: false,
        readinessChecked: false,
        working: true,
        onConnectWallet: vi.fn(),
        onGrossAmountChange: vi.fn(),
        onSourceChange: vi.fn(),
        onAddSource: vi.fn(),
        onRemoveSource: vi.fn(),
        onDepositSource: vi.fn(),
        onDepositRecoveryHashChange: vi.fn(),
        onRefreshUnifiedBalance: vi.fn(),
        onSubmit: vi.fn(),
        onCheckReadiness: vi.fn(),
        onLater: vi.fn(),
      }),
    );

    const submitButton = html.match(
      /<button[^>]*aria-busy="true"[^>]*disabled=""[^>]*type="button">Submit funding plan/,
    );
    expect(submitButton).not.toBeNull();
  });

  it('keeps source guidance in the Unified Balance summary and enables a valid locked deposit', () => {
    const html = renderToStaticMarkup(
      createElement(FundingAllocations, {
        program: program(),
        grossAmount: '10',
        sources,
        errors: {},
        walletAddress: WALLET,
        walletName: 'Test wallet',
        walletPending: false,
        walletError: undefined,
        depositStatuses: {},
        depositRequiredAmounts: {},
        depositRecoveryHashes: {},
        confirmedUnifiedBalance: '0',
        pendingUnifiedBalance: '0',
        estimatedFeeReserve: '0.25',
        transactionsEnabled: true,
        canSubmit: true,
        readinessChecked: true,
        working: false,
        onConnectWallet: vi.fn(),
        onGrossAmountChange: vi.fn(),
        onSourceChange: vi.fn(),
        onAddSource: vi.fn(),
        onRemoveSource: vi.fn(),
        onDepositSource: vi.fn(),
        onDepositRecoveryHashChange: vi.fn(),
        onRefreshUnifiedBalance: vi.fn(),
        onSubmit: vi.fn(),
        onCheckReadiness: vi.fn(),
        onLater: vi.fn(),
      }),
    );

    expect((html.match(/No deposit in this intent yet/g) ?? []).length).toBe(1);
    expect(html).toContain('Ready to deposit');
    expect(html).toContain('!flex min-w-0 flex-row items-center');
    const addButtons = html.match(/<button[^>]*>Add to Unified Balance<\/button>/g) ?? [];
    expect(addButtons).toHaveLength(2);
    expect(addButtons.every((button) => !button.includes('disabled=""'))).toBe(true);
  });

  it('keeps Add to Unified Balance disabled before the server intent is locked', () => {
    const html = renderToStaticMarkup(
      createElement(FundingAllocations, {
        program: program(),
        grossAmount: '10',
        sources,
        errors: {},
        walletAddress: WALLET,
        walletName: 'Test wallet',
        walletPending: false,
        walletError: undefined,
        depositStatuses: {},
        depositRequiredAmounts: {},
        depositRecoveryHashes: {},
        confirmedUnifiedBalance: undefined,
        pendingUnifiedBalance: undefined,
        estimatedFeeReserve: undefined,
        transactionsEnabled: false,
        canSubmit: false,
        readinessChecked: false,
        working: false,
        onConnectWallet: vi.fn(),
        onGrossAmountChange: vi.fn(),
        onSourceChange: vi.fn(),
        onAddSource: vi.fn(),
        onRemoveSource: vi.fn(),
        onDepositSource: vi.fn(),
        onDepositRecoveryHashChange: vi.fn(),
        onRefreshUnifiedBalance: vi.fn(),
        onSubmit: vi.fn(),
        onCheckReadiness: vi.fn(),
        onLater: vi.fn(),
      }),
    );

    const addButtons = html.match(/<button[^>]*>Add to Unified Balance<\/button>/g) ?? [];
    expect(addButtons).toHaveLength(2);
    expect(addButtons.every((button) => button.includes('disabled=""'))).toBe(true);
  });

  it('does not claim that no deposit exists when another source is already pending', () => {
    const html = renderToStaticMarkup(
      createElement(FundingAllocations, {
        program: program(),
        grossAmount: '10',
        sources,
        errors: {},
        walletAddress: WALLET,
        walletName: 'Test wallet',
        walletPending: false,
        walletError: undefined,
        depositStatuses: { arc: 'pending' },
        depositRequiredAmounts: {},
        depositRecoveryHashes: {},
        confirmedUnifiedBalance: '0',
        pendingUnifiedBalance: '4',
        estimatedFeeReserve: '0.25',
        transactionsEnabled: true,
        canSubmit: true,
        readinessChecked: true,
        working: false,
        onConnectWallet: vi.fn(),
        onGrossAmountChange: vi.fn(),
        onSourceChange: vi.fn(),
        onAddSource: vi.fn(),
        onRemoveSource: vi.fn(),
        onDepositSource: vi.fn(),
        onDepositRecoveryHashChange: vi.fn(),
        onRefreshUnifiedBalance: vi.fn(),
        onSubmit: vi.fn(),
        onCheckReadiness: vi.fn(),
        onLater: vi.fn(),
      }),
    );

    expect(html).not.toContain('No deposit in this intent yet');
    expect(html).toContain('Existing confirmed Unified Balance can satisfy selected allocations');
  });

  it.each(['confirmed', 'recovery_required', 'submitting'] as const)(
    'keeps deposits fail-closed for %s state',
    (status) => {
      const html = renderToStaticMarkup(
        createElement(FundingAllocations, {
          program: program(),
          grossAmount: '10',
          sources,
          errors: {},
          walletAddress: WALLET,
          walletName: 'Test wallet',
          walletPending: false,
          walletError: undefined,
          depositStatuses: { arc: status, base: status },
          depositRequiredAmounts: {},
          depositRecoveryHashes: {},
          confirmedUnifiedBalance: '0',
          pendingUnifiedBalance: '0',
          estimatedFeeReserve: '0.25',
          transactionsEnabled: true,
          canSubmit: true,
          readinessChecked: true,
          working: false,
          onConnectWallet: vi.fn(),
          onGrossAmountChange: vi.fn(),
          onSourceChange: vi.fn(),
          onAddSource: vi.fn(),
          onRemoveSource: vi.fn(),
          onDepositSource: vi.fn(),
          onDepositRecoveryHashChange: vi.fn(),
          onRefreshUnifiedBalance: vi.fn(),
          onSubmit: vi.fn(),
          onCheckReadiness: vi.fn(),
          onLater: vi.fn(),
        }),
      );

      const actionButtons =
        status === 'submitting'
          ? (html.match(/<button[^>]*aria-busy="true"[^>]*>/g) ?? [])
          : (html.match(
              /<button[^>]*>(?:Check deposit|Recover deposit|Add to Unified Balance)<\/button>/g,
            ) ?? []);
      expect(actionButtons).toHaveLength(2);
      expect(actionButtons.every((button) => button.includes('disabled=""'))).toBe(true);
    },
  );

  it('keeps a submitted deposit check actionable while the submit plan stays fail-closed', () => {
    const html = renderToStaticMarkup(
      createElement(FundingAllocations, {
        program: program(),
        grossAmount: '10',
        sources,
        errors: {},
        walletAddress: WALLET,
        walletName: 'Test wallet',
        walletPending: false,
        walletError: undefined,
        depositStatuses: { arc: 'pending', base: 'pending' },
        depositRequiredAmounts: {},
        depositRecoveryHashes: {},
        confirmedUnifiedBalance: '0',
        pendingUnifiedBalance: '10',
        estimatedFeeReserve: '0.25',
        transactionsEnabled: true,
        canSubmit: false,
        readinessChecked: false,
        working: false,
        onConnectWallet: vi.fn(),
        onGrossAmountChange: vi.fn(),
        onSourceChange: vi.fn(),
        onAddSource: vi.fn(),
        onRemoveSource: vi.fn(),
        onDepositSource: vi.fn(),
        onDepositRecoveryHashChange: vi.fn(),
        onRefreshUnifiedBalance: vi.fn(),
        onSubmit: vi.fn(),
        onCheckReadiness: vi.fn(),
        onLater: vi.fn(),
      }),
    );

    const checkButtons = html.match(/<button[^>]*>Check deposit<\/button>/g) ?? [];
    expect(checkButtons).toHaveLength(2);
    expect(checkButtons.every((button) => !button.includes('disabled=""'))).toBe(true);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Submit funding plan<\/button>/);
  });

  it('shows a non-wallet verification notice and spinner while checking a pending deposit', () => {
    const html = renderToStaticMarkup(
      createElement(FundingAllocations, {
        program: program(),
        grossAmount: '10',
        sources,
        errors: {},
        walletAddress: WALLET,
        walletName: 'Test wallet',
        walletPending: false,
        walletError: undefined,
        depositStatuses: { arc: 'pending', base: 'pending' },
        depositRequiredAmounts: {},
        depositRecoveryHashes: {},
        checkingDepositRowId: 'arc',
        depositTransactionHashes: {
          arc: `0x${'a'.repeat(64)}`,
          base: `0x${'b'.repeat(64)}`,
        },
        confirmedUnifiedBalance: '0',
        pendingUnifiedBalance: '10',
        estimatedFeeReserve: '0.25',
        notice:
          'Deposit submitted. Waiting for Circle Gateway confirmation… checking automatically; no wallet signature is required.',
        transactionsEnabled: true,
        canSubmit: false,
        readinessChecked: false,
        working: true,
        onConnectWallet: vi.fn(),
        onGrossAmountChange: vi.fn(),
        onSourceChange: vi.fn(),
        onAddSource: vi.fn(),
        onRemoveSource: vi.fn(),
        onDepositSource: vi.fn(),
        onDepositRecoveryHashChange: vi.fn(),
        onRefreshUnifiedBalance: vi.fn(),
        onSubmit: vi.fn(),
        onCheckReadiness: vi.fn(),
        onLater: vi.fn(),
      }),
    );

    expect(html).toContain('Deposit verification in progress');
    expect(html).toContain('no wallet signature is required');
    expect(html).toContain('This deposit is moving through Circle Gateway');
    expect(html).toContain('https://testnet.arcscan.app/tx/');
    expect(html).toContain('https://sepolia.basescan.org/tx/');
    const checkButtons = html.match(/<button[^>]*>Check deposit/g) ?? [];
    expect(checkButtons).toHaveLength(2);
    expect(checkButtons.every((button) => button.includes('disabled=""'))).toBe(true);
    expect(html.match(/<button[^>]*data-loading=""[^>]*>Check deposit/g) ?? []).toHaveLength(1);
  });

  it('renders only valid network explorer links for pending source hashes', () => {
    const explorerSources: readonly FundingSource[] = [
      { rowId: 'arc', network: 'Arc_Testnet', amount: '1' },
      { rowId: 'eth', network: 'Ethereum_Sepolia', amount: '1' },
      { rowId: 'arb', network: 'Arbitrum_Sepolia', amount: '1' },
      { rowId: 'base', network: 'Base_Sepolia', amount: '1' },
    ];
    const hashes = {
      arc: `0x${'a'.repeat(64)}`,
      eth: `0x${'b'.repeat(64)}`,
      arb: `0x${'c'.repeat(64)}`,
      base: `0x${'d'.repeat(64)}`,
    };
    const render = (depositTransactionHashes: Readonly<Record<string, string>>) =>
      renderToStaticMarkup(
        createElement(FundingAllocations, {
          program: program(),
          grossAmount: '4',
          sources: explorerSources,
          errors: {},
          walletAddress: WALLET,
          walletName: 'Test wallet',
          walletPending: false,
          walletError: undefined,
          depositStatuses: { arc: 'pending', eth: 'pending', arb: 'pending', base: 'pending' },
          depositRequiredAmounts: {},
          depositRecoveryHashes: {},
          depositTransactionHashes,
          confirmedUnifiedBalance: '0',
          pendingUnifiedBalance: '4',
          estimatedFeeReserve: '0.25',
          transactionsEnabled: true,
          canSubmit: false,
          readinessChecked: false,
          working: false,
          onConnectWallet: vi.fn(),
          onGrossAmountChange: vi.fn(),
          onSourceChange: vi.fn(),
          onAddSource: vi.fn(),
          onRemoveSource: vi.fn(),
          onDepositSource: vi.fn(),
          onDepositRecoveryHashChange: vi.fn(),
          onRefreshUnifiedBalance: vi.fn(),
          onSubmit: vi.fn(),
          onCheckReadiness: vi.fn(),
          onLater: vi.fn(),
        }),
      );

    const html = render(hashes);
    expect(html).toContain('https://testnet.arcscan.app/tx/');
    expect(html).toContain('https://sepolia.etherscan.io/tx/');
    expect(html).toContain('https://sepolia.arbiscan.io/tx/');
    expect(html).toContain('https://sepolia.basescan.org/tx/');
    expect(html.match(/View transaction/g) ?? []).toHaveLength(4);

    const withoutHash = render({ arc: hashes['arc']!, eth: '   ' });
    expect(withoutHash.match(/View transaction/g) ?? []).toHaveLength(1);
    expect(withoutHash).not.toContain('https://sepolia.etherscan.io/tx/');
  });
});
