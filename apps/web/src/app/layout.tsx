import './globals.css';
import '@rainbow-me/rainbowkit/styles.css';

import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { Providers } from '@/providers/providers';

/*
 * Inter is loaded through next/font so it is self-hosted and subsetted at build time. The design
 * system references it by the `--font-inter` variable that theme.css feeds into `--font-sans`.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'BountyEscrow',
  description:
    'Guaranteed escrow, transparent reward pools and USDC settlement for Web3 bug bounties.',
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background text-text antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
