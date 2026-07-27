import { z } from 'zod';

import type { ApiError, ApiErrorResponse } from '../types/api.js';
import { jsonValueSchema } from './json-value.js';
import { nonEmptyTrimmedTextSchema, stringIdentifierSchema } from './primitives.js';

const apiErrorResponseShapeSchema = z
  .object({
    success: z.literal(false),
    error: z
      .object({
        code: stringIdentifierSchema,
        message: nonEmptyTrimmedTextSchema,
        details: jsonValueSchema.optional(),
      })
      .strict(),
    correlationId: stringIdentifierSchema.optional(),
  })
  .strict();

export const apiErrorResponseSchema = apiErrorResponseShapeSchema.transform(
  (value): ApiErrorResponse => {
    const error: ApiError = {
      code: value.error.code,
      message: value.error.message,
      ...(value.error.details === undefined ? {} : { details: value.error.details }),
    };

    return {
      success: false,
      error,
      ...(value.correlationId === undefined ? {} : { correlationId: value.correlationId }),
    };
  },
);

export type ApiErrorResponseSchemaOutput = z.output<typeof apiErrorResponseSchema>;
