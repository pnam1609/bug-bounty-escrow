import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadEscrowArtifact } from '../src/escrow/escrow-artifact.js';

const artifactPath = fileURLToPath(
  new URL('../../../packages/contracts/artifacts/BountyEscrow.v1.json', import.meta.url),
);

describe('escrow artifact', () => {
  it('loads the generated production artifact with a valid checksum', async () => {
    const artifact = await loadEscrowArtifact(artifactPath);

    expect(artifact.version).toBe('1.1.0');
    expect(artifact.bytecode).toMatch(/^0x[0-9a-f]+$/i);
    expect(artifact.deployedBytecode).toMatch(/^0x[0-9a-f]+$/i);
  });

  it('rejects a runtime checksum that does not match normalized deployed bytecode', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'bbe-escrow-artifact-'));
    const tamperedArtifactPath = join(temporaryDirectory, 'BountyEscrow.v1.json');

    try {
      const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as {
        runtimeBytecodeSha256: string;
      };
      artifact.runtimeBytecodeSha256 = `0x${'0'.repeat(64)}`;
      await writeFile(tamperedArtifactPath, JSON.stringify(artifact));

      await expect(loadEscrowArtifact(tamperedArtifactPath)).rejects.toMatchObject({
        code: 'escrow_artifact_runtime_checksum_mismatch',
        retryable: false,
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects changed deployed bytecode even when the artifact checksum is recomputed', async () => {
    const temporaryDirectory = await mkdtemp(join(tmpdir(), 'bbe-escrow-artifact-'));
    const tamperedArtifactPath = join(temporaryDirectory, 'BountyEscrow.v1.json');

    try {
      const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as Record<
        string,
        unknown
      > & {
        artifactSha256: string;
        deployedBytecode: string;
        immutableReferences: Record<string, { start: number; length: number }[]>;
      };
      const deployedBytecode = Buffer.from(artifact.deployedBytecode.slice(2), 'hex');
      const immutableByteOffsets = new Set<number>();
      for (const references of Object.values(artifact.immutableReferences)) {
        for (const { start, length } of references) {
          for (let offset = start; offset < start + length; offset += 1) {
            immutableByteOffsets.add(offset);
          }
        }
      }
      const mutableByteOffset = deployedBytecode.findIndex(
        (_value, offset) => !immutableByteOffsets.has(offset),
      );
      expect(mutableByteOffset).toBeGreaterThanOrEqual(0);
      deployedBytecode.writeUInt8(
        deployedBytecode.readUInt8(mutableByteOffset) ^ 1,
        mutableByteOffset,
      );
      artifact.deployedBytecode = `0x${deployedBytecode.toString('hex')}`;

      const canonicalArtifact: Record<string, unknown> = { ...artifact };
      delete canonicalArtifact['artifactSha256'];
      delete canonicalArtifact['runtimeBytecodeSha256'];
      artifact.artifactSha256 = `0x${createHash('sha256')
        .update(JSON.stringify(canonicalArtifact))
        .digest('hex')}`;
      await writeFile(tamperedArtifactPath, JSON.stringify(artifact));

      await expect(loadEscrowArtifact(tamperedArtifactPath)).rejects.toMatchObject({
        code: 'escrow_artifact_runtime_checksum_mismatch',
        retryable: false,
      });
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
