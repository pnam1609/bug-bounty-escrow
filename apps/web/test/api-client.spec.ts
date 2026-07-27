import { programListResponseSchema } from '@bug-bounty-escrow/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, safeReturnPath } from '../src/lib/api-client';
import { queryKeys } from '../src/lib/query-keys';

beforeEach(() => {
  Object.assign(process.env, {
    NEXT_PUBLIC_API_BASE_URL: 'https://api.example.test',
    NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-anon',
    NEXT_PUBLIC_ARC_RPC_URL: 'https://rpc.example.test',
    NEXT_PUBLIC_ARC_EXPLORER_URL: 'https://explorer.example.test',
    NEXT_PUBLIC_ARC_CHAIN_ID: '5042002',
    NEXT_PUBLIC_USDC_ADDRESS: '0x0000000000000000000000000000000000000001',
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('typed web platform', () => {
  it.each([
    ['https://evil.test', '/programs'],
    ['//evil.test', '/programs'],
    ['/\\evil', '/programs'],
    // Encoded control characters (`%2F%09%2F…` in the query) decode to raw tab/newline before this
    // check runs; the WHATWG URL parser then strips them pre-parse, so "/\t/evil.test" would
    // reassemble into the protocol-relative "//evil.test" at navigation time.
    ['/\t/evil.test', '/programs'],
    ['/\n/evil.test', '/programs'],
    ['/\r/evil.test', '/programs'],
    ['/reports\u0000', '/programs'],
    // A percent sequence that survives decoding stays opaque path text on this origin.
    ['/%2Fnot-a-host', '/%2Fnot-a-host'],
    ['/reports/one', '/reports/one'],
  ])('normalizes return path %s', (input, expected) => {
    expect(safeReturnPath(input)).toBe(expected);
  });

  it('parses API responses and sends bearer tokens without exposing them in URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          data: [],
          metadata: {
            page: 1,
            limit: 20,
            totalItems: 0,
            totalPages: 0,
            hasNextPage: false,
            hasPreviousPage: false,
          },
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      apiRequest('/api/programs', programListResponseSchema, {
        token: 'private-token',
      }),
    ).resolves.toHaveProperty('data', []);
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://api.example.test/api/programs');
    expect(url.toString()).not.toContain('private-token');
    expect((options.headers as Headers).get('Authorization')).toBe('Bearer private-token');
  });

  it('uses stable, resource-scoped query keys', () => {
    expect(queryKeys.report('report-a')).toEqual(['report', 'report-a']);
    expect(queryKeys.comments('report-a')).toEqual(['report', 'report-a', 'comments']);
  });
});
