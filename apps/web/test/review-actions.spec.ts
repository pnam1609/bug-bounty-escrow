import { reportDetailSchema, type ReportDetail } from '@bug-bounty-escrow/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { duplicateTargetIsSafe, ReviewActions } from '@/components/reports/review-actions';

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
  capabilities: { canEdit: false, canResubmit: false },
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
      duplicateTargetIsSafe(REPORT_ID, PROGRAM_ID, {
        id: '10000000-0000-4000-8000-000000000099',
        programId: PROGRAM_ID,
      }),
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
});
