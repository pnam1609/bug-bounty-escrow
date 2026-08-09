import { stringToHex, type EIP1193Provider } from 'viem';

export const ARC_TESTNET_CHAIN_ID = 5_042_002;

export async function assertWalletContext(
  provider: EIP1193Provider,
  expectedAddress: string,
  expectedChainId = ARC_TESTNET_CHAIN_ID,
): Promise<void> {
  const [accounts, chain] = await Promise.all([
    provider.request({ method: 'eth_accounts', params: undefined }),
    provider.request({ method: 'eth_chainId', params: undefined }),
  ]);

  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== 'string' ||
    accounts[0].toLowerCase() !== expectedAddress.toLowerCase()
  ) {
    throw new Error('wallet_account_changed');
  }
  if (
    typeof chain !== 'string' ||
    !/^0x[0-9a-f]+$/iu.test(chain) ||
    Number.parseInt(chain, 16) !== expectedChainId
  ) {
    throw new Error('wallet_chain_changed');
  }
}

export async function signResearcherWalletChallenge(
  provider: EIP1193Provider,
  expectedAddress: string,
  message: string,
): Promise<`0x${string}`> {
  await assertWalletContext(provider, expectedAddress);
  const signature = await provider.request({
    method: 'personal_sign',
    params: [stringToHex(message), expectedAddress],
  } as never);

  if (typeof signature !== 'string' || !/^0x(?:[0-9a-f]{128}|[0-9a-f]{130})$/iu.test(signature)) {
    throw new Error('wallet_signature_invalid');
  }

  await assertWalletContext(provider, expectedAddress);
  return signature as `0x${string}`;
}

export function isWalletRequestRejected(error: unknown): boolean {
  const visited = new Set<object>();
  let candidate = error;

  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof candidate !== 'object' || candidate === null || visited.has(candidate)) return false;
    visited.add(candidate);
    const record = candidate as { cause?: unknown; code?: unknown; name?: unknown };
    if (
      record.code === 4001 ||
      record.code === 'ACTION_REJECTED' ||
      record.name === 'UserRejectedRequestError'
    ) {
      return true;
    }
    candidate = record.cause;
  }

  return false;
}
