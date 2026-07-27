import { defineConfig } from '@playwright/test';

const publicEnvironment = {
  NEXT_PUBLIC_API_BASE_URL: 'http://127.0.0.1:3001',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-demo-anon',
  NEXT_PUBLIC_ARC_RPC_URL: 'https://rpc.example.test',
  NEXT_PUBLIC_ARC_EXPLORER_URL: 'https://explorer.example.test',
  NEXT_PUBLIC_ARC_CHAIN_ID: '5042002',
  NEXT_PUBLIC_USDC_ADDRESS: '0x0000000000000000000000000000000000000001',
  NEXT_PUBLIC_DEMO_MODE: 'true',
};

export default defineConfig({
  testDir: './e2e',
  outputDir: '.next/playwright-results',
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev --hostname 127.0.0.1 --port 3000',
    url: 'http://127.0.0.1:3000/programs',
    reuseExistingServer: false,
    timeout: 120_000,
    env: publicEnvironment,
  },
});
