'use client';

import {
  researcherPayoutWalletListResponseSchema,
  type ResearcherPayoutWallet,
} from '@bug-bounty-escrow/shared';
import { Button, Callout, Card, RadioGroup, RadioGroupCard } from '@bug-bounty-escrow/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Plus, ShieldCheck, Wallet } from 'lucide-react';
import { useEffect, useState } from 'react';

import { AddResearcherWalletDialog } from './add-researcher-wallet-dialog';
import { PAYOUT_WALLETS_PATH, payoutWalletSelectionError } from './researcher-wallet-model';
import { arcExplorerHref } from '@/components/reports/crypto-value';
import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import type { RewardWalletAvailability } from '@/components/submit-bug/submit-bug-model';
import { CopyButton } from '@/components/reports/copy-value';

export interface ResearcherWalletPickerProps {
  readonly accessToken: string | undefined;
  readonly error?: string;
  readonly onAvailabilityChange?: (availability: RewardWalletAvailability) => void;
  readonly onChange: (walletId: string) => void;
  readonly onWalletsChange?: (wallets: readonly ResearcherPayoutWallet[]) => void;
  readonly principalId: string;
  readonly value: string;
}

function WalletLabel({ wallet }: { readonly wallet: ResearcherPayoutWallet }) {
  return (
    <span className="flex min-w-0 flex-col gap-xs">
      <span className="flex flex-wrap items-center gap-sm">
        <span>{wallet.label ?? 'Verified wallet'}</span>
        <span className="inline-flex items-center gap-xs rounded-full border border-success px-sm py-xs text-label-sm text-success">
          <ShieldCheck aria-hidden="true" className="size-4" />
          Verified
        </span>
      </span>
      <span className="font-mono text-body-sm text-text">{wallet.maskedAddress}</span>
    </span>
  );
}

export function ResearcherWalletPicker({
  accessToken,
  error,
  onAvailabilityChange,
  onChange,
  onWalletsChange,
  principalId,
  value,
}: ResearcherWalletPickerProps) {
  const client = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const query = useQuery({
    queryKey: queryKeys.payoutWallets(principalId),
    enabled: accessToken !== undefined,
    queryFn: async () =>
      (
        await apiRequest(PAYOUT_WALLETS_PATH, researcherPayoutWalletListResponseSchema, {
          token: accessToken,
        })
      ).data,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  useEffect(() => {
    const availability: RewardWalletAvailability =
      query.isPending || query.isFetching ? 'loading' : query.isError ? 'error' : 'ready';
    onAvailabilityChange?.(availability);
    if (query.data !== undefined) onWalletsChange?.(query.data);
  }, [
    onAvailabilityChange,
    onWalletsChange,
    query.data,
    query.isError,
    query.isFetching,
    query.isPending,
  ]);

  if (query.isPending || query.isFetching) {
    return (
      <Card aria-busy="true" className="gap-md" padding="lg" role="status">
        <p className="text-label-lg text-text">Loading your verified wallets…</p>
        <div
          aria-hidden="true"
          className="h-24 animate-pulse rounded-md bg-surface-raised motion-reduce:animate-none"
        />
      </Card>
    );
  }

  if (query.isError || query.data === undefined) {
    return (
      <Callout title="We couldn’t load your verified wallets" variant="danger">
        <div className="flex flex-col items-start gap-md">
          <p>Your report draft is unchanged. Retry before selecting a reward destination.</p>
          <Button onClick={() => void query.refetch()} type="button" variant="secondary">
            Retry wallets
          </Button>
        </div>
      </Callout>
    );
  }

  const wallets = query.data;
  const derivedError =
    error ?? (value === '' ? undefined : (payoutWalletSelectionError(wallets, value) ?? undefined));

  return (
    <div className="flex flex-col gap-xl" id="payoutWalletId">
      {wallets.length === 0 ? (
        <Card className="items-start gap-md" padding="lg">
          <span
            aria-hidden="true"
            className="flex size-11 items-center justify-center rounded-full bg-surface-raised"
          >
            <Wallet className="size-xl text-text-muted" />
          </span>
          <h3 className="text-h3 text-text">No verified wallet yet</h3>
          <p className="text-body-sm text-text-muted">
            Add an EVM wallet you control. You will sign a message once to verify the address.
          </p>
          <Button onClick={() => setAddOpen(true)} type="button">
            Add wallet
          </Button>
        </Card>
      ) : (
        <RadioGroup aria-label="Verified reward wallets" onValueChange={onChange} value={value}>
          {wallets.map((wallet) => (
            <div className="flex flex-col gap-sm" key={wallet.id}>
              <RadioGroupCard
                description="EVM · Arc Testnet"
                icon={<Wallet className="size-xl" />}
                title={<WalletLabel wallet={wallet} />}
                value={wallet.id}
              />
              <div className="flex justify-end">
                <CopyButton value={wallet.address} what="reward wallet address" />
                <a
                  aria-label="Open reward wallet address in Arc explorer (opens external site)"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm text-low hover:underline"
                  href={arcExplorerHref(wallet.address, 'address')}
                  rel="noreferrer"
                  target="_blank"
                  title="Open reward wallet address in Arc explorer"
                >
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
              </div>
            </div>
          ))}
        </RadioGroup>
      )}

      {derivedError === undefined ? null : (
        <p className="text-body-sm text-error" role="alert">
          {derivedError}
        </p>
      )}

      {wallets.length === 0 ? null : (
        <Button
          className="w-fit"
          onClick={() => setAddOpen(true)}
          type="button"
          variant="secondary"
        >
          <Plus aria-hidden="true" className="size-4" />
          Add another wallet
        </Button>
      )}

      <AddResearcherWalletDialog
        accessToken={accessToken}
        onOpenChange={setAddOpen}
        onVerified={(wallet) => {
          client.setQueryData<readonly ResearcherPayoutWallet[]>(
            queryKeys.payoutWallets(principalId),
            (current = []) =>
              current.some((entry) => entry.id === wallet.id) ? current : [...current, wallet],
          );
          onChange(wallet.id);
        }}
        open={addOpen}
      />
    </div>
  );
}
