import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';
import { initiateSmartContractPlatformClient } from '@circle-fin/smart-contract-platform';

type Artifact = { readonly abi: readonly unknown[]; readonly bytecode: `0x${string}` };
const ARC_TESTNET = 'ARC-TESTNET';
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function address(name: string): `0x${string}` {
  const value = required(name);
  if (!ADDRESS.test(value)) throw new Error(`${name} must be an EVM address`);
  return value as `0x${string}`;
}
function uuid(name: string): string {
  const value = required(name);
  if (!UUID.test(value)) throw new Error(`${name} must be a UUID`);
  return value;
}

const apiKey = required('CIRCLE_API_KEY');
const entitySecret = required('CIRCLE_ENTITY_SECRET');
const walletId = uuid('CIRCLE_DEPLOYMENT_WALLET_ID');
const tokenAddress = address('PLATFORM_FEE_TOKEN_ADDRESS');
const feeAmount = required('PLATFORM_FEE_AMOUNT_BASE_UNITS');
if (!/^\d+$/.test(feeAmount) || BigInt(feeAmount) <= 0n) {
  throw new Error('PLATFORM_FEE_AMOUNT_BASE_UNITS must be a positive integer');
}

const artifactPath = resolve(
  process.cwd(),
  process.env['BOUNTY_ESCROW_ADMIN_ARTIFACT_PATH'] ?? 'packages/contracts/artifacts/BountyEscrowAdmin.v1.json',
);
const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as Artifact;
if (!Array.isArray(artifact.abi) || typeof artifact.bytecode !== 'string' || !artifact.bytecode.startsWith('0x')) {
  throw new Error(`Invalid contract artifact: ${artifactPath}`);
}

const baseUrl = process.env['CIRCLE_API_BASE_URL'] ?? 'https://api.circle.com';
const wallets = initiateDeveloperControlledWalletsClient({
  apiKey, entitySecret, baseUrl, userAgent: 'bounty-escrow-admin-deployer/1.0',
});
const contracts = initiateSmartContractPlatformClient({
  apiKey, entitySecret, baseUrl, userAgent: 'bounty-escrow-admin-deployer/1.0',
});

const walletResponse = await wallets.getWallet({ id: walletId });
const wallet = walletResponse.data?.wallet;
if (
  wallet === undefined || wallet.id !== walletId || wallet.blockchain !== ARC_TESTNET ||
  wallet.custodyType !== 'DEVELOPER' || wallet.accountType !== 'SCA' || wallet.state !== 'LIVE' ||
  typeof wallet.address !== 'string' || !ADDRESS.test(wallet.address)
) {
  throw new Error('Circle deployment wallet must be a LIVE developer-controlled Arc Testnet SCA');
}

const idempotencyKey = uuid('BOUNTY_ESCROW_ADMIN_DEPLOY_IDEMPOTENCY_KEY');

const acceptedResponse = await contracts.deployContract({
  idempotencyKey,
  name: 'BountyEscrowAdmin',
  description: 'Platform fee and program escrow controller for Bounty Escrow',
  walletId,
  blockchain: ARC_TESTNET,
  abiJson: JSON.stringify(artifact.abi),
  bytecode: artifact.bytecode,
  constructorParameters: [wallet.address, tokenAddress, feeAmount],
  fee: { type: 'level', config: { feeLevel: 'MEDIUM' } },
} as Parameters<typeof contracts.deployContract>[0]);
const accepted = acceptedResponse.data;
const contractId = accepted?.contractId;
const transactionId = accepted?.transactionId;
if (typeof contractId !== 'string' || typeof transactionId !== 'string') {
  throw new Error('Circle did not return contract and transaction IDs');
}

const timeoutMs = Number(process.env['CIRCLE_POLL_TIMEOUT_MS'] ?? 120_000);
const intervalMs = Number(process.env['CIRCLE_POLL_INTERVAL_MS'] ?? 2_000);
const deadline = Date.now() + timeoutMs;
let lastState: string | undefined;
while (Date.now() < deadline) {
  const [transactionResponse, contractResponse] = await Promise.all([
    wallets.getTransaction({ id: transactionId }), contracts.getContract({ id: contractId }),
  ]);
  const transaction = transactionResponse.data?.transaction;
  const contract = contractResponse.data?.contract;
  lastState = transaction?.state ?? contract?.status;
  if (['FAILED', 'CANCELLED', 'DENIED'].includes(transaction?.state ?? '') || contract?.status === 'FAILED') {
    throw new Error(`Circle deployment failed (transaction=${transaction?.state ?? 'unknown'}, contract=${contract?.status ?? 'unknown'})`);
  }
  if (transaction?.state === 'COMPLETE' && contract?.status === 'COMPLETE' && contract.contractAddress && transaction.txHash) {
    console.log(JSON.stringify({
      chain: ARC_TESTNET, walletId, walletAddress: wallet.address, contractId, transactionId,
      contractAddress: contract.contractAddress, transactionHash: transaction.txHash,
      tokenAddress, feeAmountBaseUnits: feeAmount, idempotencyKey,
    }, null, 2));
    process.exit(0);
  }
  await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
}
console.log(JSON.stringify({
  chain: ARC_TESTNET, walletId, walletAddress: wallet.address, contractId, transactionId,
  state: lastState, tokenAddress, feeAmountBaseUnits: feeAmount, idempotencyKey,
}, null, 2));
process.exit(2);
