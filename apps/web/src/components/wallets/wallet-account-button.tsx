'use client';

import { Button } from '@bug-bounty-escrow/ui';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { ChevronDown } from 'lucide-react';

export function WalletAccountButton({ className }: { readonly className?: string }) {
  return (
    <ConnectButton.Custom>
      {({ account, chain, mounted, openAccountModal, openChainModal, openConnectModal }) => {
        if (!mounted) {
          return <span className="block h-11" aria-hidden="true" />;
        }
        if (account === undefined) {
          return (
            <Button
              className={className}
              data-wallet-resume-focus="true"
              onClick={openConnectModal}
              type="button"
            >
              Connect wallet
            </Button>
          );
        }
        if (chain?.unsupported === true) {
          return (
            <Button
              className={className}
              data-wallet-resume-focus="true"
              onClick={openChainModal}
              type="button"
              variant="secondary"
            >
              Switch network
            </Button>
          );
        }
        return (
          <Button
            aria-label={`Open wallet account menu for ${account.displayName}`}
            className={className}
            data-wallet-resume-focus="true"
            onClick={openAccountModal}
            type="button"
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
