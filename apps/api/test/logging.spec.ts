import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { AppLogger, createPinoLogger } from '../src/logging/app-logger.service.js';

describe('structured logging redaction', () => {
  it('redacts required secrets and report data in captured JSON output', () => {
    let captured = '';
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        captured += chunk.toString();
        callback();
      },
    });
    const logger = new AppLogger(createPinoLogger('info', destination));
    const sensitiveValues = [
      'Bearer private-token',
      'session=private-cookie',
      'anon-secret',
      'service-role-secret',
      'gemini-secret',
      'private title',
      'private content',
      'private impact',
      'private reproduction',
      'private steps',
      'signed-secret',
    ];

    logger.info(
      {
        correlationId: 'request-123',
        headers: {
          authorization: sensitiveValues[0],
          cookie: sensitiveValues[1],
        },
        SUPABASE_ANON_KEY: sensitiveValues[2],
        SUPABASE_SERVICE_ROLE_KEY: sensitiveValues[3],
        GEMINI_API_KEY: sensitiveValues[4],
        report: {
          title: sensitiveValues[5],
          content: sensitiveValues[6],
          impact: sensitiveValues[7],
          reproduction: sensitiveValues[8],
          reproductionSteps: sensitiveValues[9],
        },
        attachment: `https://storage.example.test/file?token=${sensitiveValues[10]}`,
      },
      'Safe event',
    );

    const record = JSON.parse(captured) as Record<string, unknown>;

    expect(record).toMatchObject({
      level: 30,
      message: 'Safe event',
      correlationId: 'request-123',
      SUPABASE_ANON_KEY: '[REDACTED]',
      SUPABASE_SERVICE_ROLE_KEY: '[REDACTED]',
      GEMINI_API_KEY: '[REDACTED]',
    });
    expect(captured).toContain('[REDACTED]');
    for (const sensitiveValue of sensitiveValues) {
      expect(captured).not.toContain(sensitiveValue);
    }
    expect(record).not.toHaveProperty('body');
  });
});
