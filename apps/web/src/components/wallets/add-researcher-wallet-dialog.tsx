'use client';

import {
  createPayoutWalletChallengeRequestSchema,
  payoutWalletChallengeResponseSchema,
  researcherPayoutWalletListResponseSchema,
  researcherPayoutWalletResponseSchema,
  verifyPayoutWalletRequestSchema,
  type ResearcherPayoutWallet,
} from '@bug-bounty-escrow/shared';
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
} from '@bug-bounty-escrow/ui';
import { useAccount, useSwitchChain } from 'wagmi';
import { useEffect, useRef, useState } from 'react';
import type { EIP1193Provider } from 'viem';

import {
  challengeStillMatches,
  describeWalletVerificationError,
  PAYOUT_WALLET_CHALLENGES_PATH,
  PAYOUT_WALLETS_PATH,
  payoutWalletChallengePath,
} from './researcher-wallet-model';
import {
  ARC_TESTNET_CHAIN_ID,
  assertWalletContext,
  isWalletRequestRejected,
  signResearcherWalletChallenge,
} from './wallet-signature';
import { WalletAccountButton } from './wallet-account-button';
import { ApiClientError, apiRequest } from '@/lib/api-client';

type VerificationPhase = 'idle' | 'requesting' | 'signing' | 'verifying';

const PHASE_LABEL: Readonly<Record<VerificationPhase, string>> = Object.freeze({
  idle: '',
  requesting: 'Preparing a secure verification request…',
  signing: 'Confirm the verification message in your wallet…',
  verifying: 'Verifying wallet ownership…',
});

export interface AddResearcherWalletDialogProps {
  readonly accessToken: string | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onVerified: (wallet: ResearcherPayoutWallet) => void;
  readonly open: boolean;
}

export function AddResearcherWalletDialog({
  accessToken,
  onOpenChange,
  onVerified,
  open,
}: AddResearcherWalletDialogProps) {
  const { address, chainId, connector, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const [label, setLabel] = useState('');
  const [phase, setPhase] = useState<VerificationPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const identity = useRef<string | undefined>(undefined);
  const busy = phase !== 'idle';
  const onArc = chainId === ARC_TESTNET_CHAIN_ID;

  useEffect(() => {
    const nextIdentity =
      isConnected && address !== undefined && connector !== undefined
        ? `${connector.id}:${address.toLowerCase()}:${String(chainId ?? '')}`
        : undefined;
    if (identity.current !== undefined && identity.current !== nextIdentity) {
      setPhase('idle');
      setError(
        nextIdentity === undefined
          ? null
          : 'The active wallet changed. Verify the currently connected address again.',
      );
    }
    identity.current = nextIdentity;
  }, [address, chainId, connector, isConnected]);

  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setError(null);
      setLabel('');
    }
  }, [open]);

  async function recoverVerifiedWallet(expectedAddress: string): Promise<boolean> {
    try {
      const response = await apiRequest(
        PAYOUT_WALLETS_PATH,
        researcherPayoutWalletListResponseSchema,
        { token: accessToken },
      );
      const existing = response.data.find(
        (wallet) => wallet.address.toLowerCase() === expectedAddress.toLowerCase(),
      );
      if (existing === undefined) return false;
      onVerified(existing);
      onOpenChange(false);
      return true;
    } catch {
      return false;
    }
  }

  async function verifyWallet(): Promise<void> {
    if (
      !isConnected ||
      address === undefined ||
      connector === undefined ||
      accessToken === undefined
    ) {
      setError('Connect a supported wallet before verifying it.');
      return;
    }
    if (!onArc) {
      setError('Switch to Arc Testnet before verifying this wallet.');
      return;
    }

    const expectedAddress = address;
    let verifySubmitted = false;
    setError(null);
    try {
      const provider = (await connector.getProvider()) as EIP1193Provider;
      await assertWalletContext(provider, expectedAddress);
      setPhase('requesting');
      const challengeRequest = createPayoutWalletChallengeRequestSchema.parse({
        address: expectedAddress,
      });
      const challenge = await apiRequest(
        PAYOUT_WALLET_CHALLENGES_PATH,
        payoutWalletChallengeResponseSchema,
        { method: 'POST', token: accessToken, body: challengeRequest },
      );
      if (!challengeStillMatches(challenge.data, expectedAddress)) {
        throw new Error('wallet_account_changed');
      }

      setPhase('signing');
      const signature = await signResearcherWalletChallenge(
        provider,
        expectedAddress,
        challenge.data.message,
      );
      const verifyRequest = verifyPayoutWalletRequestSchema.parse({
        signature,
        ...(label.trim() === '' ? {} : { label: label.trim() }),
      });
      setPhase('verifying');
      verifySubmitted = true;
      const verified = await apiRequest(
        payoutWalletChallengePath(challenge.data.id),
        researcherPayoutWalletResponseSchema,
        { method: 'POST', token: accessToken, body: verifyRequest },
      );
      onVerified(verified.data);
      onOpenChange(false);
    } catch (cause) {
      if (isWalletRequestRejected(cause)) {
        setError('Signature request was cancelled. No wallet was added.');
      } else if (
        verifySubmitted &&
        (cause instanceof TypeError ||
          (cause instanceof ApiClientError &&
            cause.code === 'wallet_verification_challenge_consumed')) &&
        (await recoverVerifiedWallet(expectedAddress))
      ) {
        return;
      } else {
        setError(describeWalletVerificationError(cause));
      }
    } finally {
      setPhase('idle');
    }
  }

  async function switchToArc(): Promise<void> {
    setError(null);
    try {
      await switchChainAsync({ chainId: ARC_TESTNET_CHAIN_ID });
    } catch (cause) {
      setError(
        isWalletRequestRejected(cause)
          ? 'Network switch was cancelled. No wallet was added.'
          : 'Arc Testnet could not be selected. Open your wallet and try again.',
      );
    }
  }

  return (
    <Dialog onOpenChange={(next) => !busy && onOpenChange(next)} open={open}>
      <DialogContent closeLabel="Close add wallet" showCloseButton size="md">
        <DialogHeader>
          <DialogTitle>Add your wallet</DialogTitle>
          <DialogDescription>
            Connect a wallet you control and sign a one-time message. The signature verifies the
            address; it does not submit a transaction or give BountyEscrow access to your funds.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2xl">
          <Field
            helperText="Optional. Give this wallet a name to distinguish it from your other verified wallets."
            label="Name"
          >
            <Input
              autoComplete="off"
              disabled={busy}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
              value={label}
            />
          </Field>

          <dl className="grid gap-md rounded-md border border-border bg-surface p-lg sm:grid-cols-2">
            <div className="flex flex-col gap-xs">
              <dt className="text-label-sm text-text-muted">Wallet type</dt>
              <dd className="text-body-sm text-text">EVM</dd>
            </div>
            <div className="flex flex-col gap-xs">
              <dt className="text-label-sm text-text-muted">Network</dt>
              <dd className="text-body-sm text-text">Arc Testnet</dd>
            </div>
          </dl>

          {isConnected && address !== undefined ? (
            <Field
              helperText="This address comes from the active RainbowKit account."
              label="Wallet address"
            >
              <Input className="font-mono" readOnly spellCheck={false} value={address} />
            </Field>
          ) : (
            <Callout title="Connect a supported wallet" variant="info">
              Use MetaMask or OKX Wallet. BountyEscrow never asks for a seed phrase or private key.
            </Callout>
          )}

          {error === null ? null : (
            <p className="text-body-sm text-error" role="alert">
              {error}
            </p>
          )}
          <p aria-live="polite" className="text-body-sm text-text-muted" role="status">
            {PHASE_LABEL[phase]}
          </p>
        </div>

        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          {!isConnected ? (
            <WalletAccountButton />
          ) : !onArc ? (
            <Button disabled={busy} onClick={() => void switchToArc()} type="button">
              Switch to Arc Testnet
            </Button>
          ) : (
            <Button
              disabled={busy}
              loading={busy}
              loadingLabel={phase === 'signing' ? 'Waiting for signature…' : 'Verifying wallet…'}
              onClick={() => void verifyWallet()}
              type="button"
            >
              Verify and add wallet
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
