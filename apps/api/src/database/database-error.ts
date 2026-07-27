export type DatabaseErrorCode =
  | 'business_rule_violation'
  | 'check_violation'
  | 'conflict'
  | 'database_unavailable'
  | 'foreign_key_violation'
  | 'forbidden'
  | 'not_found'
  | 'unauthenticated'
  | 'unique_violation'
  | 'unknown';

/**
 * Machine-readable reason emitted by an atomic RPC through `raise ... using detail = '...'`.
 *
 * The database owns the business rule, so the reason has to travel with the error for the client
 * to distinguish, for example, "program stopped accepting reports" from a transient failure.
 * Only lowercase snake_case identifiers are accepted so a raised `detail` can never leak free-form
 * text (which may contain report content) into an HTTP response.
 */
const BUSINESS_REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

interface DatabaseErrorOptions {
  readonly code: DatabaseErrorCode;
  readonly message: string;
  readonly databaseCode?: string;
  readonly reason?: string;
  readonly retryable?: boolean;
}

export class DatabaseError extends Error {
  public readonly code: DatabaseErrorCode;
  public readonly databaseCode?: string;
  public readonly reason?: string;
  public readonly retryable: boolean;

  public constructor(options: DatabaseErrorOptions) {
    super(options.message);
    this.name = 'DatabaseError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;

    if (options.databaseCode !== undefined) {
      this.databaseCode = options.databaseCode;
    }

    if (options.reason !== undefined) {
      this.reason = options.reason;
    }
  }
}

function readSafeDatabaseCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = error.code;

  if (typeof code !== 'string' || !/^(?:PGRST\d{3}|[0-9A-Z]{5})$/.test(code)) {
    return undefined;
  }

  return code;
}

function readSafeBusinessReason(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('details' in error)) {
    return undefined;
  }

  const details = error.details;

  if (typeof details !== 'string' || !BUSINESS_REASON_PATTERN.test(details)) {
    return undefined;
  }

  return details;
}

export function normalizeDatabaseError(error: unknown): DatabaseError {
  const databaseCode = readSafeDatabaseCode(error);
  const reason = readSafeBusinessReason(error);
  const withReason = reason === undefined ? {} : { reason };

  switch (databaseCode) {
    case 'PGRST116':
    case 'P0002':
      return new DatabaseError({
        code: 'not_found',
        databaseCode,
        message: 'Database record was not found',
        ...withReason,
      });
    case '22023':
      // invalid_parameter_value: every atomic RPC raises this for a violated business rule.
      return new DatabaseError({
        code: 'business_rule_violation',
        databaseCode,
        message: 'The operation is not allowed in the current state',
        ...withReason,
      });
    case '42501':
      // insufficient_privilege: the actor may not act on this record.
      return new DatabaseError({
        code: 'forbidden',
        databaseCode,
        message: 'The operation is not permitted for this actor',
        ...withReason,
      });
    case '28000':
      return new DatabaseError({
        code: 'unauthenticated',
        databaseCode,
        message: 'Authentication is required',
        ...withReason,
      });
    case '23505':
      return new DatabaseError({
        code: 'unique_violation',
        databaseCode,
        message: 'A unique database constraint was violated',
        ...withReason,
      });
    case '23503':
      return new DatabaseError({
        code: 'foreign_key_violation',
        databaseCode,
        message: 'A related database record does not exist',
        ...withReason,
      });
    case '23514':
      return new DatabaseError({
        code: 'check_violation',
        databaseCode,
        message: 'A database constraint was violated',
        ...withReason,
      });
    case '40001':
    case '40P01':
      return new DatabaseError({
        code: 'conflict',
        databaseCode,
        message: 'The database operation conflicted and may be retried',
        retryable: true,
        ...withReason,
      });
    case '57014':
      return new DatabaseError({
        code: 'database_unavailable',
        databaseCode,
        message: 'The database operation was interrupted',
        retryable: true,
        ...withReason,
      });
    default:
      return new DatabaseError({
        code: 'unknown',
        message: 'An unexpected database error occurred',
        ...(databaseCode === undefined ? {} : { databaseCode }),
      });
  }
}
