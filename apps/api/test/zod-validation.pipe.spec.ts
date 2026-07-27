import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe.js';

const metadata = (type: ArgumentMetadata['type']): ArgumentMetadata => ({
  type,
  metatype: undefined,
  data: undefined,
});

describe('ZodValidationPipe', () => {
  it.each(['body', 'query', 'param'] as const)(
    'validates %s values with an explicit schema',
    (type) => {
      const pipe = new ZodValidationPipe(z.object({ value: z.string() }));

      expect(pipe.transform({ value: 'safe' }, metadata(type))).toEqual({
        value: 'safe',
      });
    },
  );

  it('returns coerced schema output', () => {
    const pipe = new ZodValidationPipe(z.object({ page: z.coerce.number().int().positive() }));

    expect(pipe.transform({ page: '2' }, metadata('query'))).toEqual({ page: 2 });
  });

  it('honors a strict schema contract for unknown fields', () => {
    const pipe = new ZodValidationPipe(z.object({ name: z.string() }).strict());

    expect(() => pipe.transform({ name: 'valid', unexpected: 'secret' }, metadata('body'))).toThrow(
      BadRequestException,
    );
  });

  it('returns safe field details without echoing invalid values', () => {
    const pipe = new ZodValidationPipe(
      z.object({ report: z.object({ content: z.string().min(20) }) }),
    );
    const secretReport = 'private exploit';

    try {
      pipe.transform({ report: { content: secretReport } }, metadata('body'));
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse();

      expect(response).toEqual({
        success: false,
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: {
            fields: [
              {
                path: 'report.content',
                message: 'Value is outside the allowed range',
              },
            ],
          },
        },
      });
      expect(JSON.stringify(response)).not.toContain(secretReport);
    }
  });
});
