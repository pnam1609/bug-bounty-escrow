import { z } from 'zod';

import { DEFAULT_PAGE_NUMBER, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/pagination.js';
import type { PaginationMetadata } from '../types/api.js';

const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const positiveIntegerQueryStringSchema = z
  .string()
  .regex(/^[1-9]\d*$/, 'Expected a canonical positive integer')
  .transform(Number)
  .pipe(positiveSafeIntegerSchema);

const paginationIntegerSchema = z.union([
  positiveSafeIntegerSchema,
  positiveIntegerQueryStringSchema,
]);

export const paginationPageSchema = paginationIntegerSchema;

export const paginationLimitSchema = paginationIntegerSchema.pipe(z.number().max(MAX_PAGE_SIZE));

export const paginationQuerySchema = z
  .object({
    page: paginationPageSchema.default(DEFAULT_PAGE_NUMBER),
    limit: paginationLimitSchema.default(DEFAULT_PAGE_SIZE),
  })
  .strict();

export const paginationMetadataSchema: z.ZodType<PaginationMetadata> = z
  .object({
    page: positiveSafeIntegerSchema,
    limit: positiveSafeIntegerSchema.max(MAX_PAGE_SIZE),
    totalItems: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    totalPages: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  })
  .strict();

export type PaginationQueryInput = z.input<typeof paginationQuerySchema>;
export type PaginationQuery = z.output<typeof paginationQuerySchema>;
export type PaginationMetadataSchemaOutput = z.output<typeof paginationMetadataSchema>;
