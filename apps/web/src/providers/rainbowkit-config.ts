import { okxWallet, metaMaskWallet } from '@rainbow-me/rainbowkit/wallets';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import { createConfig, http } from 'wagmi';
import type { Chain } from 'viem';
import { FUNDING_NETWORK_CONFIG } from '@bug-bounty-escrow/blockchain';
import { ArcTestnet as CircleArcTestnet } from '@circle-fin/app-kit/chains';

/**
 * The wallet modal deliberately exposes only the two wallets supported by the funding
 * product. RainbowKit owns discovery, installation links, account switching and disconnect;
 * the Circle adapter remains the transaction execution boundary.
 */
const walletConnectProjectId =
  process.env['NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? '00000000000000000000000000000000';

function chain(
  id: number,
  name: string,
  nativeCurrency: { readonly name: string; readonly symbol: string; readonly decimals: 18 },
  rpcUrl: string,
  explorerUrl: string,
): Chain {
  return {
    id,
    name,
    nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: { default: { name: `${name} Explorer`, url: explorerUrl } },
  };
}

export const arcTestnet = chain(
  FUNDING_NETWORK_CONFIG.Arc_Testnet.chainId,
  CircleArcTestnet.name,
  CircleArcTestnet.nativeCurrency,
  CircleArcTestnet.rpcEndpoints[0] ?? 'https://rpc.testnet.arc.network',
  CircleArcTestnet.explorerUrl.replace(/\/tx\/\{hash\}$/u, ''),
);

export const ethereumSepolia = chain(
  FUNDING_NETWORK_CONFIG.Ethereum_Sepolia.chainId,
  'Ethereum Sepolia',
  { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://sepolia.etherscan.io',
);

export const arbitrumSepolia = chain(
  FUNDING_NETWORK_CONFIG.Arbitrum_Sepolia.chainId,
  'Arbitrum Sepolia',
  { name: 'Arbitrum Sepolia Ether', symbol: 'ETH', decimals: 18 },
  'https://sepolia-rollup.arbitrum.io/rpc',
  'https://sepolia.arbiscan.io',
);

export const baseSepolia = chain(
  FUNDING_NETWORK_CONFIG.Base_Sepolia.chainId,
  'Base Sepolia',
  { name: 'Base Sepolia Ether', symbol: 'ETH', decimals: 18 },
  'https://sepolia.base.org',
  'https://sepolia.basescan.org',
);

export const rainbowChains = [arcTestnet, ethereumSepolia, arbitrumSepolia, baseSepolia] as const;

const connectors = connectorsForWallets(
  [
    {
      groupName: 'Supported wallets',
      wallets: [metaMaskWallet, okxWallet],
    },
  ],
  {
    appName: 'BountyEscrow',
    projectId: walletConnectProjectId,
    appDescription: 'USDC escrow for bug bounty programs.',
    appUrl: 'https://bountyescrow.xyz',
  },
);

export const rainbowConfig = createConfig({
  chains: rainbowChains,
  connectors,
  transports: {
    [arcTestnet.id]: http(arcTestnet.rpcUrls.default.http[0]),
    [ethereumSepolia.id]: http(ethereumSepolia.rpcUrls.default.http[0]),
    [arbitrumSepolia.id]: http(arbitrumSepolia.rpcUrls.default.http[0]),
    [baseSepolia.id]: http(baseSepolia.rpcUrls.default.http[0]),
  },
  ssr: true,
});

export const supportedRainbowChainIds = new Set(rainbowChains.map(({ id }) => id));
