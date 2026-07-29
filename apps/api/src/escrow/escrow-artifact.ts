import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { z } from 'zod';

import { EscrowProviderError, type EscrowArtifact } from './escrow-gateways.js';

const bytecodeSchema = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/);
const hashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const artifactSchema = z
  .object({
    contractName: z.literal('BountyEscrow'),
    version: z.literal('1.1.0'),
    compilerVersion: z.string().min(1),
    compilerSettings: z
      .object({
        optimizer: z.object({ enabled: z.literal(true), runs: z.literal(200) }).strict(),
        metadata: z.object({ bytecodeHash: z.literal('none') }).strict(),
        evmVersion: z.literal('cancun'),
        viaIR: z.literal(false),
      })
      .strict(),
    abi: z.array(z.unknown()),
    bytecode: bytecodeSchema,
    deployedBytecode: bytecodeSchema,
    immutableReferences: z.record(
      z.string(),
      z.array(
        z
          .object({
            start: z.number().int().nonnegative(),
            length: z.number().int().positive(),
          })
          .strict(),
      ),
    ),
    artifactSha256: hashSchema,
    runtimeBytecodeSha256: hashSchema,
  })
  .strict();

function normalizedRuntimeBytecode(
  deployedBytecode: string,
  immutableReferences: Readonly<
    Record<string, readonly { start: number; length: number }[]>
  >,
): Buffer {
  const normalized = Buffer.from(deployedBytecode.slice(2), 'hex');
  for (const references of Object.values(immutableReferences)) {
    for (const { start, length } of references) {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(length) ||
        start + length > normalized.length
      ) {
        throw new EscrowProviderError('escrow_artifact_invalid', false);
      }
      normalized.fill(0, start, start + length);
    }
  }
  return normalized;
}

export async function loadEscrowArtifact(path: string): Promise<EscrowArtifact> {
  let raw: string;
  try {
    raw = await readFile(resolve(path), 'utf8');
  } catch {
    throw new EscrowProviderError('escrow_artifact_unavailable', false);
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    throw new EscrowProviderError('escrow_artifact_invalid', false);
  }
  const parsed = artifactSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new EscrowProviderError('escrow_artifact_invalid', false);
  }
  const canonicalArtifact = {
    contractName: parsed.data.contractName,
    version: parsed.data.version,
    compilerVersion: parsed.data.compilerVersion,
    compilerSettings: parsed.data.compilerSettings,
    abi: parsed.data.abi,
    bytecode: parsed.data.bytecode,
    deployedBytecode: parsed.data.deployedBytecode,
    immutableReferences: parsed.data.immutableReferences,
  };
  const checksum = `0x${createHash('sha256')
    .update(JSON.stringify(canonicalArtifact))
    .digest('hex')}`;
  if (checksum.toLowerCase() !== parsed.data.artifactSha256.toLowerCase()) {
    throw new EscrowProviderError('escrow_artifact_checksum_mismatch', false);
  }
  const runtimeChecksum = `0x${createHash('sha256')
    .update(
      normalizedRuntimeBytecode(
        parsed.data.deployedBytecode,
        parsed.data.immutableReferences,
      ),
    )
    .digest('hex')}`;
  if (runtimeChecksum.toLowerCase() !== parsed.data.runtimeBytecodeSha256.toLowerCase()) {
    throw new EscrowProviderError('escrow_artifact_runtime_checksum_mismatch', false);
  }
  return {
    version: '1.1.0',
    abi: parsed.data.abi,
    bytecode: parsed.data.bytecode as `0x${string}`,
    deployedBytecode: parsed.data.deployedBytecode as `0x${string}`,
    immutableReferences: parsed.data.immutableReferences,
    artifactSha256: parsed.data.artifactSha256 as `0x${string}`,
    runtimeBytecodeSha256: parsed.data.runtimeBytecodeSha256 as `0x${string}`,
  };
}
