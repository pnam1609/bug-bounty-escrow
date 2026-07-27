import { BadRequestException, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import type { JsonValue } from '@bug-bounty-escrow/shared';
import { z } from 'zod';

import { createApiErrorResponse } from '../http/api-error.js';

function safeIssueMessage(issue: z.ZodError['issues'][number]): string {
  switch (issue.code) {
    case 'invalid_type':
      return 'Expected a valid value';
    case 'too_big':
    case 'too_small':
      return 'Value is outside the allowed range';
    case 'invalid_format':
      return 'Value has an invalid format';
    case 'unrecognized_keys':
      return 'Unknown field';
    default:
      return 'Invalid value';
  }
}

function safeIssuePath(issue: z.ZodError['issues'][number], metadata: ArgumentMetadata): string {
  const issuePath = issue.path.map(String).join('.');

  if (issuePath.length > 0) {
    return issuePath;
  }

  return metadata.data ?? metadata.type;
}

export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<
  unknown,
  z.output<TSchema>
> {
  public constructor(private readonly schema: TSchema) {}

  public transform(value: unknown, metadata: ArgumentMetadata): z.output<TSchema> {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    const fields: Array<{ [key: string]: JsonValue }> = result.error.issues.map((issue) => ({
      path: safeIssuePath(issue, metadata),
      message: safeIssueMessage(issue),
    }));

    throw new BadRequestException(
      createApiErrorResponse('validation_error', 'Request validation failed', undefined, {
        fields,
      }),
    );
  }
}
