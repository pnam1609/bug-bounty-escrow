import { z } from 'zod';

const STRING_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TRANSACTION_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;
const MONETARY_AMOUNT_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export const uuidSchema = z.string().uuid();

export const stringIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(STRING_IDENTIFIER_PATTERN, 'Invalid string identifier');

export const evmAddressSchema = z.string().regex(EVM_ADDRESS_PATTERN, 'Invalid EVM address');

export const transactionHashSchema = z
  .string()
  .regex(TRANSACTION_HASH_PATTERN, 'Invalid transaction hash');

export const monetaryAmountSchema = z
  .string()
  .max(100)
  .regex(MONETARY_AMOUNT_PATTERN, 'Invalid monetary amount');

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const nonEmptyTrimmedTextSchema = z.string().trim().min(1);

export const idempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(IDEMPOTENCY_KEY_PATTERN, 'Invalid idempotency key');

/** Owner-supplied links are rendered to researchers, so plain HTTP is rejected outright. */
export const httpsUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .url()
  .refine((value) => value.toLowerCase().startsWith('https://'), 'Enter a valid HTTPS URL');

/**
 * Object key inside a Supabase bucket. Rejects absolute paths, traversal segments and control
 * characters so a caller cannot point a record at an object outside its own prefix.
 */
export const storagePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('//') &&
      !value.split('/').some((segment) => segment === '.' || segment === '..') &&
      [...value].every((character) => character.charCodeAt(0) >= 32),
    'Invalid storage path',
  );

export type Uuid = z.infer<typeof uuidSchema>;
export type StringIdentifier = z.infer<typeof stringIdentifierSchema>;
export type EvmAddress = z.infer<typeof evmAddressSchema>;
export type TransactionHash = z.infer<typeof transactionHashSchema>;
export type MonetaryAmount = z.infer<typeof monetaryAmountSchema>;
export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;
export type NonEmptyTrimmedText = z.infer<typeof nonEmptyTrimmedTextSchema>;
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;
export type HttpsUrl = z.infer<typeof httpsUrlSchema>;
export type StoragePath = z.infer<typeof storagePathSchema>;
