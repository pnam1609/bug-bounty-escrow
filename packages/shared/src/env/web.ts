import { z } from 'zod';

import { evmAddressSchema } from '../schemas/primitives.js';
import { parseEnvironment } from './validation-error.js';

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Expected an HTTP or HTTPS URL');

const publicCredentialSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected a non-empty value');

const positiveIntegerStringSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'Expected a canonical positive integer')
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

const chainIdSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  positiveIntegerStringSchema,
]);

export const webEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_API_BASE_URL: httpUrlSchema,
    NEXT_PUBLIC_SUPABASE_URL: httpUrlSchema,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: publicCredentialSchema,
    NEXT_PUBLIC_ARC_RPC_URL: httpUrlSchema,
    NEXT_PUBLIC_ARC_EXPLORER_URL: httpUrlSchema,
    NEXT_PUBLIC_ARC_CHAIN_ID: chainIdSchema,
    NEXT_PUBLIC_USDC_ADDRESS: evmAddressSchema,
  })
  .strip();

export type WebEnvironment = z.output<typeof webEnvironmentSchema>;

export function parseWebEnvironment(input: Readonly<Record<string, unknown>>): WebEnvironment {
  return parseEnvironment('web', webEnvironmentSchema, input);
}
