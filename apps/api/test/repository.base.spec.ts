import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

import {
  ATOMIC_OPERATION_GUIDANCE,
  type DatabaseResult,
  RepositoryBase,
} from '../src/database/repository.base.js';

class TestRepository extends RepositoryBase {
  public constructor(client: SupabaseClient) {
    super(client);
  }

  public unwrap<T>(result: DatabaseResult<T>): T {
    return this.unwrapResult(result);
  }

  public atomic<T>(functionName: string, parameters: Record<string, unknown>): Promise<T> {
    return this.executeAtomicRpc(functionName, parameters);
  }
}

function createRepository(rpc = vi.fn()): TestRepository {
  return new TestRepository({ rpc } as unknown as SupabaseClient);
}

describe('RepositoryBase', () => {
  it('returns successful data without hiding domain-specific queries', () => {
    const repository = createRepository();

    expect(repository.unwrap({ data: { id: 'program-1' }, error: null })).toEqual({
      id: 'program-1',
    });
  });

  it('normalizes missing data into a typed not-found error', () => {
    const repository = createRepository();

    expect(() => repository.unwrap({ data: null, error: null })).toThrowError(
      expect.objectContaining({
        name: 'DatabaseError',
        code: 'not_found',
      }),
    );
  });

  it.each([
    ['23505', 'unique_violation'],
    ['23503', 'foreign_key_violation'],
    ['23514', 'check_violation'],
  ] as const)('preserves safe constraint code %s as %s', (databaseCode, code) => {
    const repository = createRepository();

    expect(() =>
      repository.unwrap({
        data: null,
        error: {
          code: databaseCode,
          message: 'insert into reports values (private content)',
          details: 'postgres://admin:secret@example.test',
        },
      }),
    ).toThrowError(
      expect.objectContaining({
        code,
        databaseCode,
      }),
    );
  });

  it('redacts unknown database details', () => {
    const repository = createRepository();
    const unsafeDetails = 'select private_content using postgres://admin:secret@example.test';

    try {
      repository.unwrap({
        data: null,
        error: { code: 'unexpected', message: unsafeDetails },
      });
      throw new Error('Expected repository operation to fail');
    } catch (error) {
      expect(error).toMatchObject({
        name: 'DatabaseError',
        code: 'unknown',
        message: 'An unexpected database error occurred',
      });
      expect(JSON.stringify(error)).not.toContain(unsafeDetails);
    }
  });

  it('requires one dedicated RPC for an atomic multi-write workflow', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { reportId: 'report-1' },
      error: null,
    });
    const repository = createRepository(rpc);

    await expect(
      repository.atomic('submit_report_atomically', {
        program_id: 'program-1',
      }),
    ).resolves.toEqual({ reportId: 'report-1' });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('submit_report_atomically', {
      program_id: 'program-1',
    });
    expect(ATOMIC_OPERATION_GUIDANCE).toContain('one dedicated PostgreSQL function');
  });
});
