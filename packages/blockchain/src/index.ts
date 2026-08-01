/**
 * Canonical chain and token configuration shared by Web and API.
 *
 * Browser wallet adapters, Circle App Kit and server credentials stay in their
 * respective applications. This package only owns network identity and other
 * provider-independent blockchain constants.
 */

export {
  ERC20_ABI,
  ERC20_READ_ABI,
  ESCROW_ABI,
  ESCROW_OWNER_ABI,
  BOUNTY_ESCROW_ADMIN_ABI,
  GATEWAY_ABI,
} from './abis.js';

export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const ARC_TESTNET_USDC_ADDRESS =
  '0x3600000000000000000000000000000000000000' as const;

export const FUNDING_NETWORK_IDS = Object.freeze([
  'Arc_Testnet',
  'Ethereum_Sepolia',
  'Arbitrum_Sepolia',
  'Base_Sepolia',
] as const);

export type FundingNetworkId = (typeof FUNDING_NETWORK_IDS)[number];

/** Canonical USDC and Circle Gateway metadata for supported testnets. */
export const FUNDING_NETWORK_CONFIG = Object.freeze({
  Arc_Testnet: {
    chainId: ARC_TESTNET_CHAIN_ID,
    gatewayDomain: 26,
    tokenAddress: ARC_TESTNET_USDC_ADDRESS,
  },
  Ethereum_Sepolia: {
    chainId: 11_155_111,
    gatewayDomain: 0,
    tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  },
  Arbitrum_Sepolia: {
    chainId: 421_614,
    gatewayDomain: 3,
    tokenAddress: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  },
  Base_Sepolia: {
    chainId: 84_532,
    gatewayDomain: 6,
    tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  },
} as const satisfies Readonly<
  Record<FundingNetworkId, { chainId: number; gatewayDomain: number; tokenAddress: `0x${string}` }>
>);

export const GATEWAY_WALLET_EVM_TESTNET_ADDRESS =
  '0x0077777d7EBA4688BDeF3E311b846F25870A19B9' as const;

export function isFundingNetworkId(value: string): value is FundingNetworkId {
  return (FUNDING_NETWORK_IDS as readonly string[]).includes(value);
}
