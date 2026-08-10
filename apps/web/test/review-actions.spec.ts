import { reportDetailSchema, type ReportDetail } from '@bug-bounty-escrow/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

const openConnectModal = vi.hoisted(() => vi.fn());

vi.mock('@rainbow-me/rainbowkit', () => ({
  useConnectModal: () => ({ openConnectModal }),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, connector: undefined, isConnected: false }),
}));

import {
  amountWithinTier,
  configuredRewardTiers,
  connectRewardWalletViaRainbowKit,
  defaultRewardAmount,
  DuplicateTargetOptionRow,
  duplicateTargetIsSafe,
  matchingRewardTiers,
  ReviewActions,
  SettlementPreflight,
  tierDetails,
} from '@/components/reports/review-actions';

const REPORT_ID = '10000000-0000-4000-8000-000000000010';
const PROGRAM_ID = '10000000-0000-4000-8000-000000000020';
const RESEARCHER_ID = '10000000-0000-4000-8000-000000000001';
const SCOPE_ID = '10000000-0000-4000-8000-000000000030';

const report = reportDetailSchema.parse({
  id: REPORT_ID,
  programId: PROGRAM_ID,
  programName: 'Aegis Protocol',
  programSlug: 'aegis',
  researcherId: RESEARCHER_ID,
  affectedScopeId: SCOPE_ID,
  affectedScope: {
    id: SCOPE_ID,
    assetType: 'smart_contract',
    name: 'Aegis Vault',
    contractAddress: '0x1111111111111111111111111111111111111111',
  },
  title: 'Reward accounting can freeze',
  description: 'A cross-chain retry can freeze reward accounting.',
  reproductionSteps: '1. Retry the message.',
  proposedSeverity: 'high',
  status: 'validated',
  finalSeverity: 'high',
  submittedAt: '2026-07-26T10:00:00.000Z',
  updatedAt: '2026-07-26T12:00:00.000Z',
  createdAt: '2026-07-26T10:00:00.000Z',
  severityMismatchAcknowledged: false,
  impacts: [],
  attachments: [],
  capabilities: {
    canEdit: false,
    canResubmit: false,
    canReopenDuplicate: false,
    canSendBackForReview: false,
  },
  contentHash: `0x${'a'.repeat(64)}`,
});

const intent = {
  id: '20000000-0000-4000-8000-000000000010',
  reportId: REPORT_ID,
  programId: PROGRAM_ID,
  escrowAddress: '0x2222222222222222222222222222222222222222',
  ownerWallet: '0x3333333333333333333333333333333333333333',
  reportKey: `0x${'b'.repeat(64)}`,
  approvedContentHash: `0x${'a'.repeat(64)}`,
  recipientAddress: '0x4444444444444444444444444444444444444444',
  calculationType: 'flat' as const,
  amount: '1000',
  status: 'awaiting_approval' as const,
  operations: [],
  createdAt: '2026-07-26T12:00:00.000Z',
  updatedAt: '2026-07-26T12:00:00.000Z',
};

function text(renderer: ReactTestRenderer): string {
  return JSON.stringify(renderer.toJSON());
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function renderActions(
  viewerRole: 'owner' | 'reviewer',
  settlement: 'loaded' | 'absent' | 'error',
  reportOverride: ReportDetail = report,
): Promise<ReactTestRenderer> {
  process.env['NEXT_PUBLIC_API_BASE_URL'] = 'http://localhost:3001';
  process.env['NEXT_PUBLIC_SUPABASE_URL'] = 'http://localhost:54321';
  process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'] = 'test-anon-key';
  process.env['NEXT_PUBLIC_ARC_RPC_URL'] = 'http://localhost:8545';
  process.env['NEXT_PUBLIC_ARC_EXPLORER_URL'] = 'https://testnet.arcscan.app';
  process.env['NEXT_PUBLIC_ARC_CHAIN_ID'] = '5042002';
  process.env['NEXT_PUBLIC_USDC_ADDRESS'] = '0x5555555555555555555555555555555555555555';
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', {
    localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (settlement === 'loaded') {
        return new Response(JSON.stringify({ success: true, data: intent }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          success: false,
          error: {
            code: settlement === 'absent' ? 'reward_settlement_not_found' : 'gateway_unavailable',
            message: 'Synthetic settlement response',
          },
        }),
        {
          status: settlement === 'absent' ? 404 : 503,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }),
  );

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = TestRenderer.create(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ReviewActions, {
          principalId: '50000000-0000-4000-8000-000000000001',
          report: reportOverride,
          token: 'test-token',
          viewerRole,
        }),
      ),
    );
  });
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    });
  }
  if (renderer === undefined) throw new Error('ReviewActions renderer was not created.');
  return renderer;
}

describe('ReviewActions reward ownership boundary', () => {
  it('truncates only the duplicate title while keeping the id and submitted time visible', () => {
    const markup = renderToStaticMarkup(
      createElement(DuplicateTargetOptionRow, {
        option: {
          id: '10000000-0000-4000-8000-000000000099',
          title: 'A very long report title that should be truncated in the option row',
          status: 'submitted',
          submittedAt: '2026-08-10T10:30:00.000Z',
        },
      }),
    );

    expect(markup).toContain('truncate');
    expect(markup).toContain('A very long report title that should be truncated in the option row');
    expect(markup).toContain('10000000');
    expect(markup).toContain('Aug 10, 2026');
  });

  it('keeps both settlement address actions in one constrained row at every viewport', () => {
    let renderer!: ReactTestRenderer;

    act(() => {
      renderer = TestRenderer.create(createElement(SettlementPreflight, { intent }));
    });

    const addressRow = renderer.root.findByProps({
      'data-settlement-address-row': '',
    });
    const copyActions = renderer.root.findAllByType('button');

    expect(addressRow.props['aria-label']).toBe('Settlement addresses');
    expect(addressRow.props['role']).toBe('group');
    expect(addressRow.props['className']).toContain('grid-cols-2');
    expect(addressRow.props['className']).toContain('min-w-0');
    expect(copyActions).toHaveLength(2);
    expect(copyActions.every((action) => action.props['className'].includes('max-w-full'))).toBe(
      true,
    );
    expect(text(renderer)).toContain('0x4444…4444');
    expect(text(renderer)).toContain('0x2222…2222');
  });

  it('copies each full settlement address and announces accessible feedback', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(createElement(SettlementPreflight, { intent }));
    });

    const copyActions = renderer.root.findAllByType('button');
    expect(copyActions[0]?.props['aria-label']).toContain(intent.recipientAddress);
    expect(copyActions[1]?.props['aria-label']).toContain(intent.escrowAddress);

    await act(async () => {
      copyActions[0]?.props['onClick']();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenLastCalledWith(intent.recipientAddress);
    expect(text(renderer)).toContain('Copied');

    await act(async () => {
      copyActions[1]?.props['onClick']();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenLastCalledWith(intent.escrowAddress);
    expect(renderer.root.findAllByProps({ 'aria-live': 'polite' })).toHaveLength(2);
  });

  it('uses final severity and affected asset to select reward tiers with decimal-safe bounds', () => {
    const rangeTier = {
      assetType: 'smart_contract' as const,
      severity: 'high' as const,
      calculationType: 'range' as const,
      minReward: '1.25',
      maxReward: '2.50',
    };
    const flatTier = {
      assetType: 'smart_contract' as const,
      severity: 'high' as const,
      calculationType: 'flat' as const,
      flatAmount: '5.000001',
    };
    const selected = matchingRewardTiers({
      ...report,
      proposedSeverity: 'critical',
      finalSeverity: 'high',
      rewardTiers: [
        rangeTier,
        flatTier,
        { ...rangeTier, severity: 'low' as const },
        { ...rangeTier, assetType: 'website' as const },
      ],
    });

    expect(selected).toEqual([rangeTier, flatTier]);
    expect(
      configuredRewardTiers({
        ...report,
        finalSeverity: 'high',
        rewardTiers: [rangeTier, flatTier, { ...rangeTier, severity: 'low' as const }],
      } as ReportDetail),
    ).toHaveLength(3);
    expect(amountWithinTier('1.250000', rangeTier)).toBe(true);
    expect(amountWithinTier('2.500001', rangeTier)).toBe(false);
    expect(amountWithinTier('5.000001', flatTier)).toBe(true);
    expect(amountWithinTier('5', flatTier)).toBe(false);
    expect(defaultRewardAmount(rangeTier)).toBe('1.25');
    expect(defaultRewardAmount(flatTier)).toBe('5.000001');
    expect(
      defaultRewardAmount({
        assetType: 'smart_contract',
        severity: 'high',
        calculationType: 'percentage',
        percentageBps: 1250,
        maxRewardCap: '1000',
      }),
    ).toBe('');
  });

  it('describes matching range, flat, and percentage tiers without floating-point bounds', () => {
    expect(
      tierDetails({
        assetType: 'smart_contract',
        severity: 'high',
        calculationType: 'range',
        minReward: '10',
        maxReward: '20',
      }),
    ).toContain('Range · 10–20 USDC');
    expect(
      tierDetails({
        assetType: 'smart_contract',
        severity: 'high',
        calculationType: 'flat',
        flatAmount: '12.5',
      }),
    ).toContain('Flat · 12.5 USDC');
    expect(
      tierDetails({
        assetType: 'smart_contract',
        severity: 'high',
        calculationType: 'percentage',
        percentageBps: 1250,
        maxRewardCap: '1000',
      }),
    ).toContain('Percentage · 12.5% · cap 1000 USDC');
  });

  it('opens the RainbowKit modal instead of requesting an arbitrary injected provider', async () => {
    openConnectModal.mockClear();

    await expect(
      connectRewardWalletViaRainbowKit({
        address: undefined,
        connector: undefined,
        isConnected: false,
        openConnectModal,
      }),
    ).rejects.toThrow('reward_wallet_connection_required');

    expect(openConnectModal).toHaveBeenCalledOnce();
  });

  it('requires a readable same-program target before duplicate confirmation', () => {
    expect(duplicateTargetIsSafe(REPORT_ID, PROGRAM_ID, undefined)).toBe(false);
    expect(
      duplicateTargetIsSafe(REPORT_ID, PROGRAM_ID, {
        id: REPORT_ID,
        programId: PROGRAM_ID,
      }),
    ).toBe(false);
    expect(
      duplicateTargetIsSafe(REPORT_ID, PROGRAM_ID, {
        id: '10000000-0000-4000-8000-000000000099',
        programId: '10000000-0000-4000-8000-000000000098',
      }),
    ).toBe(false);
    expect(
      duplicateTargetIsSafe(
        REPORT_ID,
        PROGRAM_ID,
        {
          id: '10000000-0000-4000-8000-000000000099',
          programId: PROGRAM_ID,
          submittedAt: '2026-07-25T10:00:00.000Z',
        },
        '2026-07-26T10:00:00.000Z',
      ),
    ).toBe(true);
  });

  it('shows a non-action waiting state to reviewers after validation', async () => {
    const markup = text(await renderActions('reviewer', 'error'));

    expect(markup).toContain('Waiting for the program owner to approve the reward.');
    expect(markup).not.toMatch(
      /Approve reward|Continue approval|Resume settlement|Cancel reservation|Connect wallet/,
    );
  });

  it('keeps owner approval available when the settlement intent is absent', async () => {
    const markup = text(await renderActions('owner', 'absent'));

    expect(markup).toContain('Approve reward');
    expect(markup).not.toContain('Waiting for the program owner to approve the reward.');
  });

  it('shows the owner send-back action before reward settlement evidence exists', async () => {
    const markup = text(
      await renderActions('owner', 'absent', {
        ...report,
        capabilities: { ...report.capabilities, canSendBackForReview: true },
      }),
    );

    expect(markup).toContain('Send back for review');
  });

  it('renders owner continuation controls for a loaded durable reservation', async () => {
    const markup = text(await renderActions('owner', 'loaded'));

    expect(markup).toContain('Continue approval');
    expect(markup).toContain('Cancel reservation');
    expect(markup).not.toContain('Approve reward');
  });

  it('fails closed for owners when the settlement read is unavailable', async () => {
    const markup = text(await renderActions('owner', 'error'));

    expect(markup).toContain('Settlement state could not be verified');
    expect(markup).not.toContain('Approve reward');
  });

  it('shows reopen only to the owner when the server grants the capability', async () => {
    const duplicateReport = reportDetailSchema.parse({
      ...report,
      status: 'duplicate',
      capabilities: {
        canEdit: false,
        canResubmit: false,
        canReopenDuplicate: true,
        canSendBackForReview: false,
      },
    });
    const ownerMarkup = text(await renderActions('owner', 'absent', duplicateReport));
    const reviewerMarkup = text(await renderActions('reviewer', 'absent', duplicateReport));

    expect(ownerMarkup).toContain('Reopen duplicate');
    expect(reviewerMarkup).not.toContain('Reopen duplicate');
    expect(reviewerMarkup).toContain('owner may reopen');
  });
});
