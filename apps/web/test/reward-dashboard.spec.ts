import {
  researcherRewardSummarySchema,
  type PaginationMetadata,
  type PayoutWallet,
  type ResearcherRewardSummary,
} from '@bug-bounty-escrow/shared';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  isExpiredRewardSession,
  parseRewardPage,
  parseRewardStatus,
  resolveRewardDisplayState,
  retryRewardRequest,
  rewardApiSearchParams,
  rewardExplorerHref,
  rewardListHref,
  rewardPaginationLabel,
  rewardQueryKey,
  shortTransactionHash,
} from '@/components/rewards/reward-dashboard-model';
import { RewardList, RewardPagination } from '@/components/rewards/reward-list';
import {
  RewardEmptyState,
  RewardFilteredEmptyState,
  RewardListSkeleton,
  RewardLoadError,
} from '@/components/rewards/reward-states';
import {
  isPayoutWalletConfirmationError,
  payoutWalletAddressError,
  payoutWalletSaveError,
  shouldConfirmPayoutWalletChange,
} from '@/components/rewards/reward-wallet-model';
import { PayoutWalletCard } from '@/components/rewards/reward-wallet';
import { ApiClientError } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

const REPORT_ID = '10000000-0000-4000-8000-000000000001';
const PROGRAM_ID = '20000000-0000-4000-8000-000000000001';
const TRANSACTION_HASH = `0x${'b'.repeat(64)}`;
const EXPLORER = 'https://explorer.example.test/';
const CHAIN_ID = '5042002';

function reward(overrides: Partial<ResearcherRewardSummary> = {}): ResearcherRewardSummary {
  return researcherRewardSummarySchema.parse({
    reportId: REPORT_ID,
    programId: PROGRAM_ID,
    programName: 'Aegis Protocol',
    reportTitle: 'Accounting invariant bypass',
    finalSeverity: 'critical',
    status: 'reward_approved',
    approvedReward: '9007199254740993.123456',
    submittedAt: '2026-07-26T09:00:00.000Z',
    rewardApprovedAt: '2026-07-27T10:00:00.000Z',
    ...overrides,
  });
}

describe('RW-03 reward URL and request state', () => {
  it('parses only canonical status/page values and resets invalid input safely', () => {
    expect(parseRewardStatus('payment_pending')).toBe('payment_pending');
    expect(parseRewardStatus('validated')).toBeUndefined();
    expect(parseRewardStatus(null)).toBeUndefined();
    expect(parseRewardPage('3')).toBe(3);
    expect(parseRewardPage('0')).toBe(1);
    expect(parseRewardPage('3.5')).toBe(1);
    expect(parseRewardPage('90071992547409930')).toBe(1);
  });

  it('keeps status filtering and pagination server-owned', () => {
    expect(rewardApiSearchParams('paid', 3)).toBe('page=3&limit=20&status=paid');
    expect(rewardListHref('paid', 3)).toBe('/rewards?status=paid&page=3');
    expect(rewardListHref(undefined, 1)).toBe('/rewards');
    expect(rewardQueryKey('paid', 3)).toEqual({ status: 'paid', page: 3 });
    expect(queryKeys.rewards('researcher-1', rewardQueryKey('paid', 3))).toEqual([
      'private',
      'researcher-1',
      'rewards',
      { status: 'paid', page: 3 },
    ]);
  });

  it('never retries auth failures and routes an expired session distinctly', () => {
    const expired = new ApiClientError(401, 'unauthorized', 'Session expired');
    const forbidden = new ApiClientError(403, 'forbidden', 'Forbidden');

    expect(isExpiredRewardSession(expired)).toBe(true);
    expect(isExpiredRewardSession(forbidden)).toBe(false);
    expect(retryRewardRequest(0, expired)).toBe(false);
    expect(retryRewardRequest(0, forbidden)).toBe(false);
    expect(retryRewardRequest(0, new TypeError('offline'))).toBe(true);
    expect(retryRewardRequest(1, new TypeError('offline'))).toBe(false);
  });

  it('never shows cached reward amounts during refresh or after refresh failure', () => {
    const base = {
      hasData: true,
      isError: false,
      isFetching: false,
      isPending: false,
      sessionExpired: false,
      status: undefined,
      totalItems: 2,
    } as const;

    expect(resolveRewardDisplayState({ ...base, isFetching: true })).toBe('loading');
    expect(resolveRewardDisplayState({ ...base, isError: true })).toBe('error');
    expect(resolveRewardDisplayState({ ...base, sessionExpired: true })).toBe('session-expired');
    expect(resolveRewardDisplayState({ ...base, totalItems: 0 })).toBe('empty');
    expect(resolveRewardDisplayState({ ...base, status: 'paid', totalItems: 0 })).toBe(
      'filtered-empty',
    );
    expect(resolveRewardDisplayState(base)).toBe('ready');
  });
});

describe('RW-03 transaction evidence', () => {
  it('builds an external link only for the configured chain and preserves the exact hash', () => {
    const payment = { chainId: CHAIN_ID, transactionHash: TRANSACTION_HASH };

    expect(rewardExplorerHref(payment, EXPLORER, CHAIN_ID)).toBe(
      `${EXPLORER}tx/${TRANSACTION_HASH}`,
    );
    expect(rewardExplorerHref(payment, EXPLORER, '1')).toBeNull();
    expect(shortTransactionHash(TRANSACTION_HASH)).toBe(
      `${TRANSACTION_HASH.slice(0, 10)}…${TRANSACTION_HASH.slice(-8)}`,
    );
  });

  it('renders backend evidence with full accessible hash, copy live region and external label', () => {
    const paid = reward({
      status: 'paid',
      paidAt: '2026-07-27T11:00:00.000Z',
      payment: {
        chainId: CHAIN_ID,
        tokenAddress: `0x${'a'.repeat(40)}`,
        transactionHash: TRANSACTION_HASH,
        status: 'confirmed',
        confirmations: 12,
        confirmedAt: '2026-07-27T11:00:00.000Z',
      },
    });
    const html = renderToStaticMarkup(
      createElement(RewardList, {
        expectedChainId: CHAIN_ID,
        explorerBaseUrl: EXPLORER,
        reportHrefFor: (item) => `/reports/${item.reportId}`,
        rewards: [paid],
      }),
    );

    expect(html).toContain(`aria-label="Full transaction hash ${TRANSACTION_HASH}"`);
    expect(html).toContain("<span>Copy</span>");
    expect(html).toContain(
      '<span class="sr-only"> the full transaction hash</span>',
    );
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('View on Arc explorer (opens external site)');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain(`${EXPLORER}tx/${TRANSACTION_HASH}`);
    expect(html).toContain('Transaction confirmed');
    expect(html).toContain('12 confirmations');
  });
});

describe('RW-03 reward rows and states', () => {
  it('renders approved decimal rewards, required timestamps and semantic desktop/mobile layouts', () => {
    const approved = reward();
    const html = renderToStaticMarkup(
      createElement(RewardList, {
        expectedChainId: CHAIN_ID,
        explorerBaseUrl: EXPLORER,
        reportHrefFor: (item) => `/reports/${item.reportId}`,
        rewards: [approved],
      }),
    );

    expect(html).toContain('9,007,199,254,740,993.123456 USDC');
    expect(html).toContain('dateTime="2026-07-26T09:00:00.000Z"');
    expect(html).toContain('dateTime="2026-07-27T10:00:00.000Z"');
    expect(html).toContain('data-status="reward_approved"');
    expect(html).toContain('data-variant="neutral"');
    expect(html).not.toContain('data-status="paid"');
    expect(html).not.toContain('>Paid</');
    expect(html).toContain('<table');
    expect(html).toContain('<ul aria-label="Reward activity"');
    expect(html).toContain('<dl');
    expect(html).toContain('No transaction evidence yet.');
  });

  it('preserves the server-provided row order instead of sorting one page in the client', () => {
    const paid = reward({
      reportId: '10000000-0000-4000-8000-000000000002',
      reportTitle: 'Server first: paid',
      status: 'paid',
      paidAt: '2026-07-27T11:00:00.000Z',
    });
    const pending = reward({
      reportId: '10000000-0000-4000-8000-000000000003',
      reportTitle: 'Server second: pending',
      status: 'payment_pending',
    });
    const html = renderToStaticMarkup(
      createElement(RewardList, {
        expectedChainId: CHAIN_ID,
        explorerBaseUrl: EXPLORER,
        reportHrefFor: (item) => `/reports/${item.reportId}`,
        rewards: [paid, pending],
      }),
    );

    expect(html.indexOf('Server first: paid')).toBeLessThan(html.indexOf('Server second: pending'));
  });

  it('never renders private report fields or an estimated/zero reward', () => {
    const html = renderToStaticMarkup(
      createElement(RewardList, {
        expectedChainId: CHAIN_ID,
        explorerBaseUrl: EXPLORER,
        reportHrefFor: (item) => `/reports/${item.reportId}`,
        rewards: [reward()],
      }),
    );

    expect(html).not.toContain('description');
    expect(html).not.toContain('reproduction');
    expect(html).not.toContain('attachment');
    expect(html).not.toContain('reviewer note');
    expect(html).not.toContain('estimate');
    expect(html).not.toContain('0 USDC');
  });

  it('uses exact loading, empty and error copy without asking for a wallet', () => {
    const loading = renderToStaticMarkup(createElement(RewardListSkeleton));
    const empty = renderToStaticMarkup(createElement(RewardEmptyState));
    const filtered = renderToStaticMarkup(
      createElement(RewardFilteredEmptyState, { onClear: vi.fn() }),
    );
    const error = renderToStaticMarkup(createElement(RewardLoadError, { onRetry: vi.fn() }));

    expect(loading).toContain('Loading your reward activity…');
    expect(loading).not.toContain('0 USDC');
    expect(empty).toContain('No reward activity yet');
    expect(empty).toContain(
      'Validated reports will appear here after an authorized reviewer approves a reward.',
    );
    expect(empty).toContain('href="/reports"');
    expect(empty).toContain('href="/programs"');
    expect(empty.toLowerCase()).not.toContain('wallet');
    expect(filtered).toContain('No rewards match this status');
    expect(error).toContain("We couldn&#x27;t load your rewards");
    expect(error).toContain(
      'Your reports and settlement records have not changed. Try loading them again.',
    );
    expect(error).toContain('>Retry</button>');
  });

  it('derives reward pagination from server metadata', () => {
    const metadata: PaginationMetadata = {
      page: 2,
      limit: 20,
      totalItems: 45,
      totalPages: 3,
      hasNextPage: true,
      hasPreviousPage: true,
    };
    const html = renderToStaticMarkup(
      createElement(RewardPagination, { metadata, onPageChange: vi.fn() }),
    );

    expect(rewardPaginationLabel(metadata)).toBe('Showing 21–40 of 45 rewards');
    expect(html).toContain('Showing 21–40 of 45 rewards');
    expect(html).toContain('aria-label="Reward pages"');
  });
});

describe('RW-04 payout wallet', () => {
  const ADDRESS = `0x${'a'.repeat(40)}`;
  const REPLACEMENT = `0x${'b'.repeat(40)}`;
  const savedWallet: PayoutWallet = {
    address: ADDRESS,
    maskedAddress: '0xaaaa…aaaa',
    network: 'Arc',
    token: 'USDC',
    hasActiveRewards: true,
    canUpdate: true,
    changeConfirmationRequired: true,
    updatedAt: '2026-07-27T12:00:00.000Z',
  };

  it('shows the reason and fixed settlement context before requesting an address', () => {
    const html = renderToStaticMarkup(
      createElement(PayoutWalletCard, {
        wallet: {
          network: 'Arc',
          token: 'USDC',
          hasActiveRewards: true,
          canUpdate: true,
          changeConfirmationRequired: false,
        },
        onSave: vi.fn(),
      }),
    );

    expect(html.indexOf('Why this address is needed')).toBeLessThan(
      html.indexOf('Payout wallet address'),
    );
    expect(html).toContain('Arc');
    expect(html).toContain('USDC');
    expect(html).toContain('does not sign you in or set your role');
    expect(html).toMatch(/aria-describedby="[^"]+-message"/);
    expect(html).toContain('Enter a public EVM address only.');
  });

  it('keeps the saved summary masked and exposes the full value only through explicit copy', () => {
    const html = renderToStaticMarkup(
      createElement(PayoutWalletCard, {
        wallet: savedWallet,
        onSave: vi.fn(),
        savedMessage: 'Payout wallet saved: 0xaaaa…aaaa.',
      }),
    );

    expect(html).toContain('0xaaaa…aaaa');
    expect(html).toContain('Payout wallet saved: 0xaaaa…aaaa.');
    expect(html).toContain('<span>Copy</span>');
    expect(html).toContain(' the full payout wallet address');
    expect(html).not.toContain(ADDRESS);
  });

  it('validates strict non-zero EVM addresses and requires confirmation for active replacements', () => {
    expect(payoutWalletAddressError('0x1234')).not.toBeNull();
    expect(payoutWalletAddressError(`0x${'0'.repeat(40)}`)).not.toBeNull();
    expect(payoutWalletAddressError(ADDRESS)).toBeNull();
    expect(shouldConfirmPayoutWalletChange(savedWallet, REPLACEMENT)).toBe(true);
    expect(shouldConfirmPayoutWalletChange(savedWallet, ADDRESS.toUpperCase())).toBe(false);
  });

  it('turns a server-side confirmation race into an explicit retry flow', () => {
    const conflict = new ApiClientError(
      409,
      'wallet_change_confirmation_required',
      'The operation is not allowed in the current state',
    );

    expect(isPayoutWalletConfirmationError(conflict)).toBe(true);
    expect(payoutWalletSaveError(conflict)).toContain('explicitly confirm');
    expect(
      isPayoutWalletConfirmationError(
        new ApiClientError(409, 'payout_wallet_not_required', 'No active reward'),
      ),
    ).toBe(false);
  });
});
