import { z } from 'zod';

import { evmAddressSchema } from '../schemas/primitives.js';
import { parseEnvironment } from './validation-error.js';

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Expected an HTTP or HTTPS URL');

const webOriginSchema = httpUrlSchema.refine((value) => {
  const parsedUrl = new URL(value);

  return value === parsedUrl.origin || value === `${parsedUrl.origin}/`;
}, 'Expected an origin without a path, query, or fragment');

const secretValueSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Expected a non-empty value');

const positiveIntegerStringSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'Expected a canonical positive integer')
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER));

const positiveIntegerSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  positiveIntegerStringSchema,
]);

const portSchema = positiveIntegerSchema.pipe(z.number().max(65_535));

export const apiEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: portSchema.default(3001),
    WEB_APP_ORIGIN: webOriginSchema,
    SUPABASE_URL: httpUrlSchema,
    SUPABASE_ANON_KEY: secretValueSchema,
    SUPABASE_SERVICE_ROLE_KEY: secretValueSchema,
    ARC_RPC_URL: httpUrlSchema,
    ARC_CHAIN_ID: positiveIntegerSchema,
    USDC_ADDRESS: evmAddressSchema,
    ESCROW_FACTORY_ADDRESS: evmAddressSchema.optional(),
    AI_PROVIDER: z.enum(['mock', 'gemini', 'disabled']).default('mock'),
    GEMINI_API_KEY: secretValueSchema.optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .strip()
  .superRefine((environment, context) => {
    if (environment.AI_PROVIDER === 'gemini' && environment.GEMINI_API_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when AI_PROVIDER is gemini',
      });
    }
  });

export type RuntimeMode = z.output<typeof apiEnvironmentSchema>['NODE_ENV'];
export type AiProvider = z.output<typeof apiEnvironmentSchema>['AI_PROVIDER'];
export type LogLevel = z.output<typeof apiEnvironmentSchema>['LOG_LEVEL'];
export type ApiEnvironment = z.output<typeof apiEnvironmentSchema>;

export function parseApiEnvironment(input: Readonly<Record<string, unknown>>): ApiEnvironment {
  return parseEnvironment('api', apiEnvironmentSchema, input);
}
