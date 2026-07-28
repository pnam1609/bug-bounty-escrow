'use client';

import {
  payoutWalletResponseSchema,
  updatePayoutWalletResponseSchema,
  type PayoutWallet,
} from '@bug-bounty-escrow/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  Field,
  Input,
} from '@bug-bounty-escrow/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useState,
  type FormEvent,
} from 'react';

import {
  isPayoutWalletConfirmationError,
  normalizedWalletInput,
  PAYOUT_WALLET_PATH,
  payoutWalletAddressError,
  payoutWalletSaveError,
  shouldConfirmPayoutWalletChange,
} from './reward-wallet-model';
import { withReturnTo } from '@/components/auth/use-auth-redirect';
import { CopyButton } from '@/components/reports/copy-value';
import { ApiClientError, apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';

const REWARD_RETURN_PATH = '/rewards';

function WalletContext({
  network,
  token,
}: {
  readonly network: PayoutWallet['network'];
  readonly token: PayoutWallet['token'];
}) {
  return (
    <dl className="flex flex-wrap gap-sm" aria-label="Payout asset">
      <div className="rounded-full border border-border bg-surface-raised px-md py-sm">
        <dt className="sr-only">Network</dt>
        <dd className="text-label-md text-text">{network}</dd>
      </div>
      <div className="rounded-full border border-border bg-surface-raised px-md py-sm">
        <dt className="sr-only">Token</dt>
        <dd className="text-label-md text-usdc">{token}</dd>
      </div>
    </dl>
  );
}

function WalletExplanation() {
  return (
    <div className="flex gap-md rounded-md bg-surface-raised p-lg">
      <ShieldCheck aria-hidden="true" className="size-xl shrink-0 text-escrow" />
      <div className="flex flex-col gap-xs">
        <p className="text-label-lg text-text">Why this address is needed</p>
        <p className="text-body-sm text-text-muted">
          An approved reward needs a public EVM destination before Arc can settle USDC to you.
          This address is only a payout destination. It does not sign you in or set your role.
        </p>
      </div>
    </div>
  );
}

export interface PayoutWalletCardProps {
  readonly confirmationAddress?: string | null;
  readonly isSaving?: boolean;
  readonly onConfirmationDismiss?: () => void;
  readonly onSave: (address: string, confirmed: boolean) => void;
  readonly saveError?: string | null;
  readonly savedMessage?: string | null;
  readonly wallet: PayoutWallet;
}

export function PayoutWalletCard({
  confirmationAddress = null,
  isSaving = false,
  onConfirmationDismiss,
  onSave,
  saveError = null,
  savedMessage = null,
  wallet,
}: PayoutWalletCardProps) {
  const [editing, setEditing] = useState(wallet.address === undefined && wallet.canUpdate);
  const [draft, setDraft] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [confirmingAddress, setConfirmingAddress] = useState<string | null>(null);
  const savedId = useId();

  useEffect(() => {
    if (confirmationAddress !== null) setConfirmingAddress(confirmationAddress);
  }, [confirmationAddress]);

  useEffect(() => {
    setEditing(wallet.address === undefined && wallet.canUpdate);
    setDraft('');
    setFieldError(null);
    if (confirmationAddress === null) setConfirmingAddress(null);
  }, [confirmationAddress, wallet.address, wallet.canUpdate, wallet.updatedAt]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const error = payoutWalletAddressError(draft);
    setFieldError(error);
    if (error !== null) return;

    const address = normalizedWalletInput(draft);
    if (shouldConfirmPayoutWalletChange(wallet, address)) {
      setConfirmingAddress(address);
      return;
    }

    onSave(address, false);
  }

  const storedWallet =
    wallet.address !== undefined && wallet.maskedAddress !== undefined
      ? { address: wallet.address, maskedAddress: wallet.maskedAddress }
      : null;
  const hasStoredWallet = storedWallet !== null;

  return (
    <>
      <Card className="gap-xl" padding="lg">
        <header className="flex flex-col gap-sm sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-md">
            <span
              aria-hidden="true"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-raised"
            >
              <Wallet className="size-xl text-text" />
            </span>
            <div className="flex flex-col gap-xs">
              <h2 className="text-h2 text-text">Payout wallet</h2>
              <p className="max-w-2xl text-body-sm text-text-muted">
                Wallet setup appears only when an approved or pending reward needs an Arc USDC
                destination.
              </p>
            </div>
          </div>
          <WalletContext network={wallet.network} token={wallet.token} />
        </header>

        <WalletExplanation />

        {hasStoredWallet ? (
          <section aria-label="Saved payout wallet" className="flex flex-col gap-md">
            <div className="flex flex-col gap-sm rounded-md border border-border p-lg sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-xs">
                <p className="text-label-sm text-text-muted">Saved Arc USDC destination</p>
                <code className="font-mono text-label-lg text-text">
                  {storedWallet.maskedAddress}
                </code>
              </div>
              <CopyButton value={storedWallet.address} what="payout wallet address" />
            </div>
            {wallet.canUpdate && !editing ? (
              <Button className="w-fit" onClick={() => setEditing(true)} variant="secondary">
                Change payout wallet
              </Button>
            ) : null}
          </section>
        ) : wallet.canUpdate ? null : (
          <p className="text-body-sm text-text-muted">
            No approved or pending reward needs a payout wallet right now. You can still browse
            programs and submit reports without one.
          </p>
        )}

        {editing && wallet.canUpdate ? (
          <form className="flex flex-col gap-xl" onSubmit={submit}>
            <Field
              error={fieldError}
              helperText="Enter a public EVM address only. Never enter a private key, seed phrase, or signature."
              label={hasStoredWallet ? 'New payout wallet address' : 'Payout wallet address'}
              required
            >
              <Input
                autoComplete="off"
                disabled={isSaving}
                inputMode="text"
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (fieldError !== null) setFieldError(payoutWalletAddressError(event.target.value));
                }}
                placeholder="0x…"
                spellCheck={false}
                value={draft}
              />
            </Field>

            {saveError === null ? null : (
              <p className="text-label-md text-error" role="alert">
                {saveError}
              </p>
            )}

            <div className="flex flex-col-reverse gap-md sm:flex-row">
              {hasStoredWallet ? (
                <Button
                  disabled={isSaving}
                  onClick={() => {
                    setEditing(false);
                    setDraft('');
                    setFieldError(null);
                  }}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                aria-describedby={savedId}
                disabled={isSaving}
                loading={isSaving}
                loadingLabel="Saving wallet…"
                type="submit"
              >
                Save payout wallet
              </Button>
            </div>
          </form>
        ) : null}

        <p aria-live="polite" className="text-label-md text-success" id={savedId}>
          {savedMessage}
        </p>
      </Card>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open && !isSaving) {
            setConfirmingAddress(null);
            onConfirmationDismiss?.();
          }
        }}
        open={confirmingAddress !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm payout wallet change</AlertDialogTitle>
            <AlertDialogDescription>
              This account has an approved or pending reward. Confirm that future settlement
              instructions should use the new address. Existing on-chain transactions cannot be
              changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-md border border-border-brand bg-surface p-md text-body-sm text-text">
            Check the address carefully. BountyEscrow never asks for a private key, seed phrase, or
            wallet signature.
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Keep current wallet</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSaving}
              onClick={() => {
                if (confirmingAddress !== null) onSave(confirmingAddress, true);
              }}
            >
              Confirm wallet change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PayoutWalletLoading() {
  return (
    <Card aria-busy="true" className="gap-md" padding="lg" role="status">
      <p className="text-label-lg text-text">Payout wallet</p>
      <p className="text-body-sm text-text-muted">Checking whether a reward needs a wallet…</p>
      <div aria-hidden="true" className="h-20 rounded-md bg-surface-raised motion-safe:animate-pulse" />
    </Card>
  );
}

function PayoutWalletLoadError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Card className="gap-md" padding="lg" role="alert">
      <h2 className="text-h3 text-text">We couldn't load your payout wallet</h2>
      <p className="text-body-sm text-text-muted">
        Reward activity is unchanged. Retry before adding or changing a destination.
      </p>
      <Button className="w-fit" onClick={onRetry} variant="secondary">
        Retry wallet
      </Button>
    </Card>
  );
}

export function RewardWalletPanel() {
  const { session } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const principalId = session?.user.id ?? 'no-session';
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [confirmationAddress, setConfirmationAddress] = useState<string | null>(null);
  const query = useQuery({
    queryKey: queryKeys.payoutWallet(principalId),
    enabled: session !== null,
    queryFn: async () =>
      (
        await apiRequest(PAYOUT_WALLET_PATH, payoutWalletResponseSchema, {
          token: session?.access_token,
        })
      ).data,
    retry: (failureCount, error) =>
      !(error instanceof ApiClientError && (error.status === 401 || error.status === 403)) &&
      failureCount < 1,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const save = useMutation({
    mutationFn: async ({
      address,
      confirmed,
    }: {
      readonly address: string;
      readonly confirmed: boolean;
    }) =>
      (
        await apiRequest(PAYOUT_WALLET_PATH, updatePayoutWalletResponseSchema, {
          method: 'PUT',
          token: session?.access_token,
          body: {
            address,
            confirmActiveRewardChange: confirmed,
          },
        })
      ).data,
    onSuccess: (wallet) => {
      queryClient.setQueryData(queryKeys.payoutWallet(principalId), wallet);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me(principalId) });
      setConfirmationAddress(null);
      setSaveError(null);
      setSavedMessage(`Payout wallet saved: ${wallet.maskedAddress ?? 'destination updated'}.`);
    },
    onError: (error, variables) => {
      setSavedMessage(null);
      setSaveError(payoutWalletSaveError(error));
      if (isPayoutWalletConfirmationError(error)) {
        setConfirmationAddress(variables.address);
        void query.refetch();
        return;
      }
      if (error instanceof ApiClientError && error.code === 'payout_wallet_not_required') {
        void query.refetch();
      }
    },
  });

  const expired =
    query.error instanceof ApiClientError &&
    (query.error.status === 401 || query.error.code === 'unauthorized');
  useEffect(() => {
    if (expired) {
      router.replace(withReturnTo('/login', REWARD_RETURN_PATH));
    }
  }, [expired, router]);

  if (expired || query.isFetching || query.isPending) return <PayoutWalletLoading />;
  if (query.isError || query.data === undefined) {
    return <PayoutWalletLoadError onRetry={() => void query.refetch()} />;
  }

  return (
    <PayoutWalletCard
      confirmationAddress={confirmationAddress}
      isSaving={save.isPending}
      onConfirmationDismiss={() => setConfirmationAddress(null)}
      onSave={(address, confirmed) => {
        if (confirmed) setConfirmationAddress(null);
        setSaveError(null);
        setSavedMessage(null);
        save.mutate({ address, confirmed });
      }}
      saveError={saveError}
      savedMessage={savedMessage}
      wallet={query.data}
    />
  );
}
