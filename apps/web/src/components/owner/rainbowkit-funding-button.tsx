'use client';

import { Button } from '@bug-bounty-escrow/ui';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ChevronDown } from 'lucide-react';

export interface RainbowKitFundingButtonProps {
  readonly className?: string;
}

/**
 * BBE's action styling around RainbowKit's supported custom renderer.
 *
 * RainbowKit still owns the connect, account and chain modals; this component only supplies the
 * product button skin so the wallet boundary uses the same primary/surface tokens as the rest of
 * CP-10, CP-11 and CP-12.
 */
export function RainbowKitFundingButton({ className }: RainbowKitFundingButtonProps) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted) return null;

        if (account === undefined) {
          return (
            <Button
              className={className}
              data-rainbow-state="disconnected"
              onClick={openConnectModal}
              size="md"
            >
              Connect wallet
            </Button>
          );
        }

        if (chain?.unsupported === true) {
          return (
            <Button
              className={`border-error [color:var(--color-error)] hover:border-error${
                className === undefined ? '' : ` ${className}`
              }`}
              data-rainbow-state="unsupported-chain"
              onClick={openChainModal}
              size="md"
              variant="secondary"
            >
              Switch network
            </Button>
          );
        }

        return (
          <Button
            aria-label={`Open wallet account menu for ${account.displayName}`}
            className={`border-border-brand bg-ambient hover:border-border-brand${
              className === undefined ? '' : ` ${className}`
            }`}
            data-rainbow-state="connected"
            data-wallet-address={account.address}
            onClick={openAccountModal}
            size="md"
            variant="secondary"
          >
            <span aria-hidden="true" className="size-sm rounded-full bg-success" />
            <span>{account.displayName}</span>
            <ChevronDown aria-hidden="true" className="size-4" />
          </Button>
        );
      }}
    </ConnectButton.Custom>
  );
}
