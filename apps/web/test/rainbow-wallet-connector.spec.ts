import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createViemAdapterFromProvider = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock('@circle-fin/adapter-viem-v2', () => ({
  createViemAdapterFromProvider,
}));

import {
  connectCircleWallet,
  connectCircleWalletFromProvider,
  discoverEvmWallets,
  isRainbowWallet,
} from '@/components/owner/circle-funding-executor';

type Provider = {
  request: ReturnType<typeof vi.fn>;
};

function installEip6963Providers(
  providers: readonly { name: string; rdns: string; provider: Provider }[],
) {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const fakeWindow = {
    addEventListener(type: string, listener: (event: Event) => void) {
      const current = listeners.get(type) ?? new Set<(event: Event) => void>();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      if (event.type === 'eip6963:requestProvider') {
        for (const [index, entry] of providers.entries()) {
          const detail = {
            info: {
              icon: '',
              name: entry.name,
              rdns: entry.rdns,
              uuid: `${entry.rdns}-${index}`,
            },
            provider: entry.provider,
          };
          listeners
            .get('eip6963:announceProvider')
            ?.forEach((listener) => listener({ detail } as unknown as Event));
        }
      }
      return true;
    },
    setTimeout,
  } as unknown as Window;

  vi.stubGlobal('window', fakeWindow);
}

function installLegacyProvider(provider: Provider & { isRainbow?: boolean }) {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const fakeWindow = {
    addEventListener(type: string, listener: (event: Event) => void) {
      const current = listeners.get(type) ?? new Set<(event: Event) => void>();
      current.add(listener);
      listeners.set(type, current);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent() {
      return true;
    },
    get ethereum() {
      return provider;
    },
    setTimeout() {
      throw new Error('discoverEvmWallets must not wait on a timer before requesting accounts');
    },
  } as unknown as Window;

  vi.stubGlobal('window', fakeWindow);
}

describe('Rainbow wallet connector', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    createViemAdapterFromProvider.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recognizes Rainbow by its EIP-6963 reverse-DNS id or display name', () => {
    expect(isRainbowWallet({ name: 'Rainbow', rdns: 'me.rainbow' })).toBe(true);
    expect(isRainbowWallet({ name: 'Rainbow Wallet', rdns: 'unknown' })).toBe(true);
    expect(isRainbowWallet({ name: 'MetaMask', rdns: 'io.metamask' })).toBe(false);
  });

  it('prefers Rainbow when several injected providers announce themselves', async () => {
    const metaMaskProvider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return ['0x1111111111111111111111111111111111111111'];
        if (method === 'eth_chainId') return '0x4cef52';
        return [];
      }),
    };
    const rainbowProvider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return ['0x2222222222222222222222222222222222222222'];
        if (method === 'eth_chainId') return '0x4cef52';
        return [];
      }),
    };
    installEip6963Providers([
      { name: 'MetaMask', rdns: 'io.metamask', provider: metaMaskProvider },
      { name: 'Rainbow', rdns: 'me.rainbow', provider: rainbowProvider },
    ]);

    const wallets = await discoverEvmWallets();
    expect(wallets.map((wallet) => wallet.name)).toEqual(['MetaMask', 'Rainbow']);

    const session = await connectCircleWallet();

    expect(session.wallet.name).toBe('Rainbow');
    expect(session.address).toBe('0x2222222222222222222222222222222222222222');
    expect(rainbowProvider.request).toHaveBeenCalledWith({
      method: 'eth_requestAccounts',
      params: undefined,
    });
    expect(metaMaskProvider.request).not.toHaveBeenCalled();
    expect(createViemAdapterFromProvider).toHaveBeenCalledOnce();
  });

  it('uses the legacy Rainbow injection without losing the click user-activation window', async () => {
    const rainbowProvider = {
      isRainbow: true,
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_requestAccounts') return ['0x3333333333333333333333333333333333333333'];
        if (method === 'eth_chainId') return '0x4cef52';
        return [];
      }),
    };
    installLegacyProvider(rainbowProvider);

    const wallets = await discoverEvmWallets();
    expect(wallets).toHaveLength(1);
    expect(wallets[0]).toMatchObject({ name: 'Rainbow', rdns: 'me.rainbow' });

    const session = await connectCircleWallet();
    expect(session.address).toBe('0x3333333333333333333333333333333333333333');
    expect(rainbowProvider.request).toHaveBeenCalledWith({
      method: 'eth_requestAccounts',
      params: undefined,
    });
  });

  it('fails closed before creating a Circle adapter on an unsupported chain', async () => {
    const provider = {
      request: vi.fn(async ({ method }: { method: string }) =>
        method === 'eth_chainId' ? '0x1' : [],
      ),
    };

    await expect(
      connectCircleWalletFromProvider(
        provider as never,
        '0x4444444444444444444444444444444444444444',
      ),
    ).rejects.toThrow('unsupported testnet');
    expect(createViemAdapterFromProvider).not.toHaveBeenCalled();
  });
});
