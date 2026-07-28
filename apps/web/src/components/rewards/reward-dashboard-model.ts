import type {
  PaginationMetadata,
  ResearcherRewardPayment,
  ResearcherRewardStatus,
} from '@bug-bounty-escrow/shared';

import { ApiClientError } from '@/lib/api-client';

export const REWARD_PAGE_SIZE = 20;

export const REWARD_STATUS_FILTERS = Object.freeze([
  { label: 'All', value: undefined },
  { label: 'Reward approved', value: 'reward_approved' },
  { label: 'Payment pending', value: 'payment_pending' },
  { label: 'Paid', value: 'paid' },
] as const satisfies readonly {
  readonly label: string;
  readonly value: ResearcherRewardStatus | undefined;
}[]);

const REWARD_STATUS_VALUES: readonly ResearcherRewardStatus[] = Object.freeze([
  'reward_approved',
  'payment_pending',
  'paid',
]);

export function parseRewardStatus(value: string | null): ResearcherRewardStatus | undefined {
  return REWARD_STATUS_VALUES.find((status) => status === value);
}

export function parseRewardPage(value: string | null): number {
  if (value === null || !/^[1-9]\d*$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : 1;
}

export function rewardApiSearchParams(
  status: ResearcherRewardStatus | undefined,
  page: number,
): string {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(REWARD_PAGE_SIZE),
  });
  if (status !== undefined) params.set('status', status);
  return params.toString();
}

export function rewardListHref(status: ResearcherRewardStatus | undefined, page: number): string {
  const params = new URLSearchParams();
  if (status !== undefined) params.set('status', status);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query === '' ? '/rewards' : `/rewards?${query}`;
}

export function rewardQueryKey(
  status: ResearcherRewardStatus | undefined,
  page: number,
): Readonly<Record<string, unknown>> {
  return { status: status ?? null, page };
}

export function isExpiredRewardSession(error: unknown): boolean {
  return error instanceof ApiClientError && (error.status === 401 || error.code === 'unauthorized');
}

export function retryRewardRequest(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiClientError && (error.status === 401 || error.status === 403)) {
    return false;
  }
  return failureCount < 1;
}

export type RewardDisplayState =
  'session-expired' | 'loading' | 'error' | 'empty' | 'filtered-empty' | 'ready';

export function resolveRewardDisplayState(input: {
  readonly hasData: boolean;
  readonly isError: boolean;
  readonly isFetching: boolean;
  readonly isPending: boolean;
  readonly sessionExpired: boolean;
  readonly status: ResearcherRewardStatus | undefined;
  readonly totalItems: number | undefined;
}): RewardDisplayState {
  if (input.sessionExpired) return 'session-expired';
  // A fresh response is required before any cached amount can be presented as current truth.
  if (input.isFetching || input.isPending) return 'loading';
  if (input.isError) return 'error';
  if (!input.hasData) return 'loading';
  if (input.totalItems === 0) {
    return input.status === undefined ? 'empty' : 'filtered-empty';
  }
  return 'ready';
}

export function rewardPaginationLabel(metadata: PaginationMetadata): string {
  if (metadata.totalItems === 0) return 'Showing 0 of 0 rewards';
  const first = (metadata.page - 1) * metadata.limit + 1;
  const last = Math.min(metadata.page * metadata.limit, metadata.totalItems);
  return `Showing ${String(first)}–${String(last)} of ${String(metadata.totalItems)} rewards`;
}

export function shortTransactionHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function rewardExplorerHref(
  payment: Pick<ResearcherRewardPayment, 'chainId' | 'transactionHash'>,
  explorerBaseUrl: string,
  expectedChainId: string,
): string | null {
  if (payment.chainId !== expectedChainId) return null;

  const url = new URL(explorerBaseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/tx/${payment.transactionHash}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}
