import type { Program } from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { FundingAllocations, FundingPending } from '@/components/owner/program-funding-views';
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
    expect(html).toContain('Connect locked wallet');
    expect(html).toContain('Arc Testnet');
    expect(html).toContain('Base Sepolia');
    expect(html).toContain('9.75 USDC');
    expect(html).toContain('Destination transaction');
    expect(html).toContain('Circle transfer');
    expect(html).toContain('Source transaction 1');
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
});
