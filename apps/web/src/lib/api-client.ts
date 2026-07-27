import type { ZodType } from 'zod';

import { readPublicConfig } from '@/config/public-config';

export class ApiClientError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export interface ApiRequestOptions {
  readonly body?: unknown | undefined;
  readonly method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | undefined;
  readonly token?: string | undefined;
}

/**
 * Raw C0 controls and DEL never belong in a path, and some are actively dangerous: the WHATWG URL
 * parser strips ASCII tab and newlines *before* parsing, so "/\t/evil.test" — which a query string
 * smuggles in as `%2F%09%2Fevil.test` — would reassemble into the protocol-relative
 * "//evil.test" at navigation time and escape the origin.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

export function safeReturnPath(value: string | null | undefined): string {
  if (
    value === undefined ||
    value === null ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return '/programs';
  }

  return value;
}

export async function apiRequest<T>(
  path: string,
  schema: ZodType<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  const config = readPublicConfig();
  const headers = new Headers({ Accept: 'application/json' });

  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.token !== undefined) {
    headers.set('Authorization', `Bearer ${options.token}`);
  }

  const response = await fetch(new URL(path, config.NEXT_PUBLIC_API_BASE_URL), {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    cache: 'no-store',
  });
  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    const error =
      typeof payload === 'object' && payload !== null && 'error' in payload
        ? (payload as { error?: { code?: unknown; message?: unknown } }).error
        : undefined;
    throw new ApiClientError(
      response.status,
      typeof error?.code === 'string' ? error.code : 'request_failed',
      typeof error?.message === 'string' ? error.message : 'Request failed',
    );
  }

  return schema.parse(payload);
}
