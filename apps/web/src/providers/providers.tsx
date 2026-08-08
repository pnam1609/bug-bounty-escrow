'use client';

import type { ReactNode } from 'react';
import { RainbowKitProvider, midnightTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';

import { AuthProvider } from './auth-provider';
import { QueryProvider } from './query-provider';
import { rainbowConfig } from './rainbowkit-config';

export function Providers({ children }: { readonly children: ReactNode }) {
  return (
    <WagmiProvider config={rainbowConfig}>
      <QueryProvider>
        <RainbowKitProvider modalSize="wide" theme={midnightTheme()}>
          <AuthProvider>{children}</AuthProvider>
        </RainbowKitProvider>
      </QueryProvider>
    </WagmiProvider>
  );
}
