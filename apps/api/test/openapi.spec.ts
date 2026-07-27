import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { OPENAPI_OUTPUT_FILE, serializeOpenApiDocument } from '../src/openapi/openapi.js';
import { createOpenApiDocument } from '../src/openapi/openapi-snapshot.js';
import { zodToOpenApiSchema } from '../src/openapi/zod-openapi.js';
import { readyHealthResponseSchema } from '../src/health/health.service.js';

describe('OpenAPI generation', () => {
  it('creates a non-empty listener-free API contract', async () => {
    const document = await createOpenApiDocument();

    expect(document.openapi).toMatch(/^3\./);
    expect(document.info).toMatchObject({
      title: 'Bug Bounty Escrow API',
      version: '1.0.0',
    });
    expect(document.servers).toContainEqual(expect.objectContaining({ url: '/api' }));
    expect(document.paths['/health']?.get).toMatchObject({
      operationId: 'getHealth',
      responses: {
        200: expect.any(Object),
        503: expect.any(Object),
      },
    });
    expect(document.paths['/reports/filter-options/programs']?.get).toMatchObject({
      operationId: 'ReportController_listProgramFilterOptions',
      responses: {
        200: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['success', 'data'],
                properties: {
                  data: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['id', 'name', 'slug'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(document.components?.schemas?.['ApiErrorResponse']).toBeDefined();
    expect(document.components?.headers?.['CorrelationId']).toBeDefined();
  });

  it('represents Zod contracts without duplicate validation DTOs', () => {
    expect(zodToOpenApiSchema(readyHealthResponseSchema)).toMatchObject({
      type: 'object',
      required: ['status', 'ready', 'dependencies'],
    });
  });

  /*
   * The checked-in file is what the frontend and any external consumer read, and until now nothing
   * compared it to the code: `openapi:check` does exactly this but was wired into no task, so the
   * committed document drifted to 20 operations while the API served 39. Asserting it here puts the
   * check on the path `turbo run test` already walks.
   */
  it('matches the checked-in openapi.json', async () => {
    const committed = await readFile(
      fileURLToPath(new URL(`../${OPENAPI_OUTPUT_FILE}`, import.meta.url)),
      'utf8',
    );
    const generated = serializeOpenApiDocument(await createOpenApiDocument());

    // Prettier reformats the file on write, so compare the parsed documents rather than the bytes.
    expect(JSON.parse(committed)).toStrictEqual(JSON.parse(generated));
  });

  it('emits deterministic output without fake secrets or host paths', async () => {
    const first = serializeOpenApiDocument(await createOpenApiDocument());
    const second = serializeOpenApiDocument(await createOpenApiDocument());

    expect(first).toBe(second);
    expect(first).not.toContain('openapi-service-role-placeholder');
    expect(first).not.toContain('openapi-anon-placeholder');
    expect(first).not.toContain('F:\\');
    expect(first).not.toContain('file://');
  });
});
