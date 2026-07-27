import { applyDecorators, Body, Param, Query } from '@nestjs/common';
import { ApiBody, ApiParam, ApiQuery, ApiResponse, type OpenAPIObject } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';

type OpenApiComponents = NonNullable<OpenAPIObject['components']>;
type OpenApiSchemas = NonNullable<OpenApiComponents['schemas']>;
type OpenApiSchema = OpenApiSchemas[string];
/** `ApiQuery`/`ApiParam` accept an inline schema only, never a `$ref`. */
type InlineSchema = Exclude<OpenApiSchema, { $ref: string }>;

export function zodToOpenApiSchema(schema: z.ZodType): OpenApiSchema {
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'draft-7',
    unrepresentable: 'any',
  });
  const openApiSchema = { ...jsonSchema };

  delete openApiSchema.$schema;

  return openApiSchema as OpenApiSchema;
}

export function ApiZodBody(schema: z.ZodType) {
  return ApiBody({ schema: zodToOpenApiSchema(schema) });
}

/*
 * Validation and documentation from one schema reference.
 *
 * Writing `@Body(new ZodValidationPipe(x))` and `@ApiZodBody(x)` separately names the schema twice,
 * and nothing fails when only one of them is updated — the spec check compares the file against the
 * code, so a stale annotation regenerates happily into a wrong document. These bind the two so the
 * request shape Swagger UI shows is by construction the shape the pipe enforces.
 *
 * A parameter decorator cannot carry method-level metadata on its own, so each applies the Nest
 * parameter decorator and then invokes the Swagger method decorator against the same method.
 */
function documentedParameter(
  bind: (pipe: ZodValidationPipe<z.ZodType>) => ParameterDecorator,
  describe: (schema: z.ZodType) => MethodDecorator,
) {
  return (schema: z.ZodType): ParameterDecorator =>
    (target, propertyKey, parameterIndex) => {
      bind(new ZodValidationPipe(schema))(target, propertyKey, parameterIndex);

      if (propertyKey === undefined) return;

      const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
      if (descriptor !== undefined) {
        describe(schema)(target, propertyKey, descriptor);
      }
    };
}

export const ZodBody = documentedParameter(
  (pipe) => Body(pipe),
  (schema) => ApiBody({ schema: zodToOpenApiSchema(schema) }) as MethodDecorator,
);

export const ZodQuery = documentedParameter(
  (pipe) => Query(pipe),
  (schema) => {
    const documented = zodToOpenApiSchema(schema);
    const properties = (documented as { properties?: Record<string, unknown> }).properties ?? {};
    const required = new Set((documented as { required?: string[] }).required ?? []);

    // Query strings are flat, so each key is documented on its own rather than as one object —
    // that is what gives Swagger UI a field per filter instead of a single JSON textarea.
    return applyDecorators(
      ...Object.entries(properties).map(([name, property]) =>
        ApiQuery({
          name,
          required: required.has(name),
          schema: property as InlineSchema,
        }),
      ),
    ) as MethodDecorator;
  },
);

export const ZodParam = documentedParameter(
  (pipe) => Param(pipe),
  (schema) => {
    const documented = zodToOpenApiSchema(schema);
    const properties = (documented as { properties?: Record<string, unknown> }).properties ?? {};

    return applyDecorators(
      ...Object.entries(properties).map(([name, property]) =>
        ApiParam({ name, required: true, schema: property as InlineSchema }),
      ),
    ) as MethodDecorator;
  },
);

export function ApiZodResponse(status: number, description: string, schema: z.ZodType) {
  return applyDecorators(
    ApiResponse({
      status,
      description,
      schema: zodToOpenApiSchema(schema),
      headers: {
        'x-correlation-id': {
          description: 'Safe request correlation identifier',
          schema: { type: 'string', maxLength: 128 },
        },
      },
    }),
  );
}
