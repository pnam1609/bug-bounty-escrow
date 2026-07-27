import { parseWebEnvironment, type WebEnvironment } from '@bug-bounty-escrow/shared';

export function readPublicConfig(): WebEnvironment {
  return parseWebEnvironment({
    NEXT_PUBLIC_API_BASE_URL: process.env['NEXT_PUBLIC_API_BASE_URL'],
    NEXT_PUBLIC_SUPABASE_URL: process.env['NEXT_PUBLIC_SUPABASE_URL'],
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    NEXT_PUBLIC_ARC_RPC_URL: process.env['NEXT_PUBLIC_ARC_RPC_URL'],
    NEXT_PUBLIC_ARC_EXPLORER_URL: process.env['NEXT_PUBLIC_ARC_EXPLORER_URL'],
    NEXT_PUBLIC_ARC_CHAIN_ID: process.env['NEXT_PUBLIC_ARC_CHAIN_ID'],
    NEXT_PUBLIC_USDC_ADDRESS: process.env['NEXT_PUBLIC_USDC_ADDRESS'],
  });
}

export const DEMO_MODE = process.env['NEXT_PUBLIC_DEMO_MODE'] === 'true';
