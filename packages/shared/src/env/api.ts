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
const durationMillisecondsSchema = positiveIntegerSchema.pipe(z.number().max(600_000));
const booleanStringSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');
const canonicalUtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/, 'Expected a canonical UTC timestamp')
  .refine((value) => {
    const timestamp = Date.parse(value);
    const canonicalValue = /\.\d{3}Z$/.test(value) ? value : value.replace(/Z$/, '.000Z');
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === canonicalValue;
  }, 'Expected a real UTC calendar timestamp');
const optionalCanonicalUtcTimestampSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}, canonicalUtcTimestampSchema.optional());
const uuidAllowlistSchema = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0),
  )
  .pipe(z.array(z.string().uuid()).max(64))
  .refine((value) => new Set(value).size === value.length, 'Expected unique UUIDs');

export const apiEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']),
    PORT: portSchema.default(3001),
    WEB_APP_ORIGIN: webOriginSchema,
    SUPABASE_URL: httpUrlSchema,
    SUPABASE_ANON_KEY: secretValueSchema,
    SUPABASE_SERVICE_ROLE_KEY: secretValueSchema,
    // Temporary, server-only hackathon waiver. A missing or blank value is
    // inactive; malformed nonblank values fail startup validation.
    LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: optionalCanonicalUtcTimestampSchema,
    ARC_RPC_URL: httpUrlSchema,
    ETHEREUM_SEPOLIA_RPC_URL: httpUrlSchema.default('https://ethereum-sepolia-rpc.publicnode.com'),
    ARBITRUM_SEPOLIA_RPC_URL: httpUrlSchema.default('https://sepolia-rollup.arbitrum.io/rpc'),
    BASE_SEPOLIA_RPC_URL: httpUrlSchema.default('https://sepolia.base.org'),
    CIRCLE_GATEWAY_TESTNET_API_URL: httpUrlSchema.default('https://gateway-api-testnet.circle.com'),
    CIRCLE_GATEWAY_WEBHOOKS_ENABLED: booleanStringSchema.default(false),
    CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS: uuidAllowlistSchema,
    ARC_CHAIN_ID: positiveIntegerSchema,
    USDC_ADDRESS: evmAddressSchema,
    ESCROW_FACTORY_ADDRESS: evmAddressSchema.optional(),
    CIRCLE_CONTRACTS_ENABLED: booleanStringSchema.default(false),
    CIRCLE_API_KEY: secretValueSchema.optional(),
    CIRCLE_ENTITY_SECRET: secretValueSchema.optional(),
    CIRCLE_DEPLOYMENT_WALLET_ID: z.string().uuid().optional(),
    CIRCLE_API_BASE_URL: httpUrlSchema.default('https://api.circle.com'),
    CIRCLE_REQUEST_TIMEOUT_MS: durationMillisecondsSchema.default(15_000),
    CIRCLE_POLL_INTERVAL_MS: durationMillisecondsSchema.default(2_000),
    CIRCLE_POLL_TIMEOUT_MS: durationMillisecondsSchema.default(120_000),
    BOUNTY_ESCROW_ARTIFACT_PATH: z
      .string()
      .min(1)
      .default('packages/contracts/artifacts/BountyEscrow.v1.json'),
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
    if (environment.CIRCLE_CONTRACTS_ENABLED) {
      for (const field of [
        'CIRCLE_API_KEY',
        'CIRCLE_ENTITY_SECRET',
        'CIRCLE_DEPLOYMENT_WALLET_ID',
      ] as const) {
        if (environment[field] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: `${field} is required when CIRCLE_CONTRACTS_ENABLED is true`,
          });
        }
      }
      if (environment.ARC_CHAIN_ID !== 5_042_002) {
        context.addIssue({
          code: 'custom',
          path: ['ARC_CHAIN_ID'],
          message: 'Circle escrow deployment is locked to Arc Testnet chain ID 5042002',
        });
      }
      if (environment.USDC_ADDRESS.toLowerCase() !== '0x3600000000000000000000000000000000000000') {
        context.addIssue({
          code: 'custom',
          path: ['USDC_ADDRESS'],
          message: 'Circle escrow deployment requires canonical Arc Testnet USDC',
        });
      }
      if (environment.CIRCLE_POLL_INTERVAL_MS >= environment.CIRCLE_POLL_TIMEOUT_MS) {
        context.addIssue({
          code: 'custom',
          path: ['CIRCLE_POLL_INTERVAL_MS'],
          message: 'Circle poll interval must be shorter than the poll timeout',
        });
      }
      if (!environment.CIRCLE_GATEWAY_WEBHOOKS_ENABLED) {
        context.addIssue({
          code: 'custom',
          path: ['CIRCLE_GATEWAY_WEBHOOKS_ENABLED'],
          message:
            'Gateway webhooks are required for independently finalized Unified Balance deposits',
        });
      }
    }
    if (environment.CIRCLE_GATEWAY_WEBHOOKS_ENABLED && environment.CIRCLE_API_KEY === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['CIRCLE_API_KEY'],
        message: 'CIRCLE_API_KEY is required when Circle Gateway webhooks are enabled',
      });
    }
    if (
      environment.CIRCLE_GATEWAY_WEBHOOKS_ENABLED &&
      environment.CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS.length !== 1
    ) {
      context.addIssue({
        code: 'custom',
        path: ['CIRCLE_GATEWAY_WEBHOOK_SUBSCRIPTION_IDS'],
        message: 'Exactly one stable Circle Gateway webhook subscription ID is required',
      });
    }
    if (
      environment.CIRCLE_GATEWAY_WEBHOOKS_ENABLED &&
      environment.CIRCLE_REQUEST_TIMEOUT_MS > 58_000
    ) {
      context.addIssue({
        code: 'custom',
        path: ['CIRCLE_REQUEST_TIMEOUT_MS'],
        message:
          'Circle Gateway request timeout exceeds the durable 15-minute subscription sync lease budget',
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
