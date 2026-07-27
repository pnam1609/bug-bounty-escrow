import type { SupabaseClient } from '@supabase/supabase-js';

import { DatabaseError, normalizeDatabaseError } from './database-error.js';

export const ATOMIC_OPERATION_GUIDANCE =
  'Multi-write atomic workflows must use one dedicated PostgreSQL function invoked through Supabase RPC.';

export interface DatabaseResult<T> {
  readonly data: T | null;
  readonly error: unknown;
}

type AtomicRpcInvoker = (
  functionName: string,
  parameters: Record<string, unknown>,
) => PromiseLike<DatabaseResult<unknown>>;

export abstract class RepositoryBase {
  protected constructor(protected readonly client: SupabaseClient) {}

  protected unwrapResult<T>(result: DatabaseResult<T>): T {
    if (result.error !== null && result.error !== undefined) {
      throw normalizeDatabaseError(result.error);
    }

    if (result.data === null) {
      throw new DatabaseError({
        code: 'not_found',
        message: 'Database record was not found',
      });
    }

    return result.data;
  }

  protected async executeAtomicRpc<T>(
    functionName: string,
    parameters: Record<string, unknown>,
  ): Promise<T> {
    if (!/^[a-z][a-z0-9_]*$/.test(functionName)) {
      throw new DatabaseError({
        code: 'unknown',
        message: 'Atomic database operation name is invalid',
      });
    }

    const invokeRpc = this.client.rpc.bind(this.client) as unknown as AtomicRpcInvoker;
    const result = await invokeRpc(functionName, parameters);

    return this.unwrapResult(result as DatabaseResult<T>);
  }
}
