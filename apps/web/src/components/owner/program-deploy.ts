import type { DeployEscrowRequest, Program } from '@bug-bounty-escrow/shared';

import { ApiClientError } from '@/lib/api-client';

export interface EscrowDeploymentOperations {
  readonly loadProgram: () => Promise<Program>;
  readonly recordDeployment: (input: DeployEscrowRequest) => Promise<Program>;
}

function sameAddress(left: string | undefined, right: string): boolean {
  return left?.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Records a confirmed deployment and recovers the one ambiguous retry case safely.
 *
 * The current backend records an externally-produced Arc deployment receipt; it does not submit a
 * factory transaction itself. Its RPC rejects every second record with
 * `program_escrow_already_deployed`. If the first HTTP response is lost after the transaction
 * commits, retrying therefore returns 409 even though the requested escrow is already correct.
 *
 * On that one code, read the owner-visible program and accept success only when the persisted
 * address matches the same payload and the lifecycle reached `awaiting_funding`. A different
 * address remains an error, so a retry can never silently adopt or create another escrow.
 */
export async function recordEscrowDeployment(
  input: DeployEscrowRequest,
  operations: EscrowDeploymentOperations,
): Promise<Program> {
  try {
    return await operations.recordDeployment(input);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== 'program_escrow_already_deployed') {
      throw error;
    }

    const saved = await operations.loadProgram();
    if (
      saved.status === 'awaiting_funding' &&
      sameAddress(saved.contractAddress, input.contractAddress)
    ) {
      return saved;
    }

    throw error;
  }
}
