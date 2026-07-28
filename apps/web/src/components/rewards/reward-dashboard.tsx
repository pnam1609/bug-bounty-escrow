'use client';

import {
  researcherRewardListResponseSchema,
  type ResearcherRewardStatus,
} from '@bug-bounty-escrow/shared';
import { Button } from '@bug-bounty-escrow/ui';
import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

import {
  isExpiredRewardSession,
  parseRewardPage,
  parseRewardStatus,
  REWARD_STATUS_FILTERS,
  resolveRewardDisplayState,
  retryRewardRequest,
  rewardApiSearchParams,
  rewardListHref,
  rewardQueryKey,
} from './reward-dashboard-model';
import { RewardList, RewardPagination } from './reward-list';
import {
  RewardEmptyState,
  RewardFilteredEmptyState,
  RewardListSkeleton,
  RewardLoadError,
} from './reward-states';
import { RewardWalletPanel } from './reward-wallet';
import { withReturnTo } from '@/components/auth/use-auth-redirect';
import { reportDetailHref } from '@/components/reports/report-detail-model';
import { readPublicConfig } from '@/config/public-config';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

const REWARD_RETURN_PATH = '/rewards';

export function RewardDashboard() {
  const { session } = useAuth();
  const router = useRouter();
  const search = useSearchParams();
  const status = parseRewardStatus(search.get('status'));
  const page = parseRewardPage(search.get('page'));
  const principalId = session?.user.id ?? 'no-session';
  const config = readPublicConfig();
  const query = useQuery({
    queryKey: queryKeys.rewards(principalId, rewardQueryKey(status, page)),
    enabled: session !== null,
    queryFn: () =>
      apiRequest(
        `/api/rewards?${rewardApiSearchParams(status, page)}`,
        researcherRewardListResponseSchema,
        { token: session?.access_token },
      ),
    retry: retryRewardRequest,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const sessionExpired = isExpiredRewardSession(query.error);
  useEffect(() => {
    if (sessionExpired) {
      router.replace(withReturnTo('/login', REWARD_RETURN_PATH));
    }
  }, [router, sessionExpired]);

  function navigate(nextStatus: ResearcherRewardStatus | undefined, nextPage: number) {
    router.replace(rewardListHref(nextStatus, nextPage), { scroll: false });
  }

  const metadata = query.data?.metadata;
  const rewards = query.data?.data;
  const returnTo = rewardListHref(status, page);
  const displayState = resolveRewardDisplayState({
    hasData: rewards !== undefined && metadata !== undefined,
    isError: query.isError,
    isFetching: query.isFetching,
    isPending: query.isPending,
    sessionExpired,
    status,
    totalItems: metadata?.totalItems,
  });

  return (
    <div className="mx-sm flex flex-col gap-xl pb-3xl md:mx-0">
      <header className="flex flex-col gap-sm">
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-sm text-body-sm text-text-muted">
            <li>Researcher workspace</li>
            <li aria-hidden="true">/</li>
            <li aria-current="page">Rewards</li>
          </ol>
        </nav>
        <h1 className="text-h1 text-text">Rewards &amp; payouts</h1>
        <p className="max-w-3xl text-body text-text-muted">
          Track human-approved USDC rewards and backend-verified on-chain settlement evidence.
        </p>
        <p className="text-label-md text-text-muted">
          Private to you · Human decision first, blockchain settlement second.
        </p>
      </header>

      <RewardWalletPanel />

      <div aria-label="Reward status filters" className="flex flex-wrap gap-sm" role="group">
        {REWARD_STATUS_FILTERS.map((filter) => {
          const active = filter.value === status;
          return (
            <Button
              aria-pressed={active}
              key={filter.label}
              onClick={() => navigate(filter.value, 1)}
              variant={active ? 'primary' : 'secondary'}
            >
              {filter.label}
            </Button>
          );
        })}
      </div>

      {displayState === 'session-expired' ? (
        <RewardListSkeleton label="Redirecting to sign in…" />
      ) : displayState === 'loading' ? (
        <RewardListSkeleton />
      ) : displayState === 'error' ? (
        <RewardLoadError onRetry={() => void query.refetch()} />
      ) : displayState === 'empty' ? (
        <RewardEmptyState />
      ) : displayState === 'filtered-empty' ? (
        <RewardFilteredEmptyState onClear={() => navigate(undefined, 1)} />
      ) : rewards !== undefined && metadata !== undefined ? (
        <>
          <p aria-live="polite" className="text-body-sm text-text-muted">
            {`${String(metadata.totalItems)} approved reward${metadata.totalItems === 1 ? '' : 's'}`}
          </p>
          <RewardList
            expectedChainId={String(config.NEXT_PUBLIC_ARC_CHAIN_ID)}
            explorerBaseUrl={config.NEXT_PUBLIC_ARC_EXPLORER_URL}
            reportHrefFor={(reward) => reportDetailHref(reward.reportId, returnTo)}
            rewards={rewards}
          />
          <RewardPagination
            disabled={query.isFetching}
            metadata={metadata}
            onPageChange={(nextPage) => navigate(status, nextPage)}
          />
        </>
      ) : null}
    </div>
  );
}
