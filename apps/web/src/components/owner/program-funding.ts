import type {
  EscrowTransaction,
  FundProgramRequest,
  Program,
} from '@bug-bounty-escrow/shared';

export interface ProgramFundingOperations {
  readonly loadProgram: () => Promise<Program>;
  readonly loadTransaction: (transactionHash: string) => Promise<EscrowTransaction>;
  readonly recordFunding: (input: FundProgramRequest) => Promise<Program>;
}

function normalizedAmount(value: string): string {
  const [whole = '0', fraction = ''] = value.trim().split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction === '' ? normalizedWhole : `${normalizedWhole}.${normalizedFraction}`;
}

function sameAddress(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

/**
 * Records a confirmed external USDC transfer and safely reconciles an ambiguous response.
 *
 * `fund_program_escrow_atomic` inserts a unique chain event and increments the program pool in one
 * database transaction. It is not retry-idempotent: submitting the same hash again conflicts with
 * the unique `(chain_id, transaction_hash, log_index)` key. If the HTTP response is lost after the
 * database commit, read the transaction by hash and accept it only when every owner-controlled
 * field still matches this exact program and request.
 */
export async function recordProgramFunding(
  programId: string,
  input: FundProgramRequest,
  operations: ProgramFundingOperations,
): Promise<Program> {
  try {
    return await operations.recordFunding(input);
  } catch (error) {
    let transaction: EscrowTransaction;

    try {
      transaction = await operations.loadTransaction(input.transactionHash);
    } catch {
      throw error;
    }

    const isSameConfirmedFunding =
      transaction.programId === programId &&
      transaction.type === 'funding' &&
      transaction.status === 'confirmed' &&
      normalizedAmount(transaction.amount) === normalizedAmount(input.amount) &&
      sameAddress(transaction.tokenAddress, input.tokenAddress);

    if (!isSameConfirmedFunding) throw error;

    return operations.loadProgram();
  }
}
