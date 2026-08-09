'use client';

import type { ResearcherPayoutWallet } from '@bug-bounty-escrow/shared';
import { Callout, Card, CardDescription, CardHeader } from '@bug-bounty-escrow/ui';

import { ResearcherWalletPicker } from '@/components/wallets/researcher-wallet-picker';
import type { RewardWalletAvailability } from './submit-bug-model';

export interface StepRewardWalletProps {
  readonly accessToken: string | undefined;
  readonly error: string | undefined;
  readonly onAvailabilityChange: (availability: RewardWalletAvailability) => void;
  readonly onChange: (walletId: string) => void;
  readonly onWalletsChange: (wallets: readonly ResearcherPayoutWallet[]) => void;
  readonly principalId: string;
  readonly value: string;
}

export function StepRewardWallet({
  accessToken,
  error,
  onAvailabilityChange,
  onChange,
  onWalletsChange,
  principalId,
  value,
}: StepRewardWalletProps) {
  return (
    <Card className="gap-2xl" padding="lg">
      <CardHeader>
        <h2 className="text-h3">Select your reward wallet</h2>
        <CardDescription>
          Choose the verified wallet where, if eligible, you would like to receive the Arc USDC
          reward for this report.
        </CardDescription>
      </CardHeader>

      <ResearcherWalletPicker
        accessToken={accessToken}
        {...(error === undefined ? {} : { error })}
        onAvailabilityChange={onAvailabilityChange}
        onChange={onChange}
        onWalletsChange={onWalletsChange}
        principalId={principalId}
        value={value}
      />

      <Callout title="Use a wallet you control" variant="warning">
        A verified address is a payout destination, not your sign-in identity. BountyEscrow never
        asks for a private key or seed phrase.
      </Callout>
    </Card>
  );
}
