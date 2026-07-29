import { describe, expect, it } from 'vitest';

import { normalizeDatabaseError } from '../src/database/database-error.js';

describe('normalizeDatabaseError', () => {
  it.each([
    ['22023', 'business_rule_violation'],
    ['42501', 'forbidden'],
    ['P0002', 'not_found'],
    ['28000', 'unauthenticated'],
    ['23505', 'unique_violation'],
    ['23503', 'foreign_key_violation'],
    ['23514', 'check_violation'],
    ['40001', 'conflict'],
    ['57014', 'database_unavailable'],
  ] as const)('classifies SQLSTATE %s as %s', (code, expected) => {
    expect(normalizeDatabaseError({ code }).code).toBe(expected);
  });

  it('carries the machine-readable rule code raised by an atomic RPC', () => {
    const error = normalizeDatabaseError({
      code: '22023',
      details: 'program_not_accepting_reports',
    });

    expect(error.code).toBe('business_rule_violation');
    expect(error.reason).toBe('program_not_accepting_reports');
  });

  it('ignores a details payload that is not a safe rule code', () => {
    // `detail` reaches the HTTP body, so free-form text (which could contain report content)
    // must never be surfaced as an error code.
    for (const details of [
      'Key (slug)=(aegis-protocol) already exists.',
      'Report title: re-entrancy drains the pool',
      'UPPER_CASE',
      '',
    ]) {
      expect(normalizeDatabaseError({ code: '22023', details }).reason).toBeUndefined();
    }
  });

  it('treats an unrecognised SQLSTATE as unknown without leaking the message', () => {
    const error = normalizeDatabaseError({
      code: 'XX000',
      message: 'postgres://admin:password@example.test/private',
    });

    expect(error.code).toBe('unknown');
    expect(error.message).toBe('An unexpected database error occurred');
  });

  it('marks transient failures as retryable', () => {
    expect(normalizeDatabaseError({ code: '40001' }).retryable).toBe(true);
    expect(normalizeDatabaseError({ code: '22023' }).retryable).toBe(false);
  });

  it('maps only the exact Gateway capacity limit to a stable conflict', () => {
    const capacity = normalizeDatabaseError({
      code: '54000',
      details: 'gateway_subscription_address_capacity_exceeded',
    });
    const unrelated = normalizeDatabaseError({
      code: '54000',
      details: 'unrelated_program_limit',
    });

    expect(capacity).toMatchObject({
      code: 'conflict',
      reason: 'gateway_subscription_address_capacity_exceeded',
      retryable: false,
    });
    expect(unrelated).toMatchObject({ code: 'unknown', reason: undefined });
  });
});
