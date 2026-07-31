import { AiProviderError } from './contracts.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const MAX_BACKOFF_MS = 2_000;

export interface JsonRequestOptions {
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly timeoutMs?: number;
  readonly maxRetries?: number;
  readonly fetchImpl?: typeof fetch;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function backoffMs(attempt: number): number {
  const base = Math.min(MAX_BACKOFF_MS, 100 * 2 ** attempt);
  // Bounded, deterministic jitter keeps tests stable while avoiding thundering retries.
  return Math.min(MAX_BACKOFF_MS, base + attempt * 17);
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function requestJson(options: JsonRequestOptions): Promise<unknown> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response: Response;
      try {
        response = await fetchImpl(options.url, {
          method: 'POST',
          headers: { ...options.headers, 'content-type': 'application/json' },
          body: JSON.stringify(options.body),
          signal: controller.signal,
        });
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          throw new AiProviderError(
            'timeout',
            'AI provider request timed out',
            attempt < maxRetries,
          );
        }
        throw new AiProviderError(
          'upstream_unavailable',
          'AI provider request failed',
          attempt < maxRetries,
        );
      }

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new AiProviderError('unauthorized', 'AI provider authorization failed');
        }
        if (!isRetryableStatus(response.status) || attempt >= maxRetries) {
          const code = response.status === 429 ? 'rate_limited' : 'upstream_unavailable';
          throw new AiProviderError(code, `AI provider returned HTTP ${response.status}`);
        }
        await sleep(backoffMs(attempt));
        continue;
      }

      try {
        return await response.json();
      } catch {
        throw new AiProviderError('invalid_response', 'AI provider returned invalid JSON');
      }
    } catch (error: unknown) {
      if (error instanceof AiProviderError && error.retryable && attempt < maxRetries) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new AiProviderError('upstream_unavailable', 'AI provider retries exhausted');
}

export function parseModelJson(content: unknown): unknown {
  if (typeof content !== 'string') {
    return content;
  }
  const trimmed = content.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new AiProviderError('invalid_response', 'AI provider response was not valid JSON');
  }
}

export function extractGeminiText(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) {
    throw new AiProviderError('invalid_response', 'Gemini response shape is invalid');
  }
  const candidate = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidate) || candidate.length === 0) {
    throw new AiProviderError('invalid_response', 'Gemini returned no candidates');
  }
  const content = (candidate[0] as { content?: { parts?: Array<{ text?: unknown }> } }).content;
  const text = content?.parts?.find((part) => typeof part.text === 'string')?.text;
  if (typeof text !== 'string') {
    throw new AiProviderError('invalid_response', 'Gemini returned no text content');
  }
  return parseModelJson(text);
}

export function extractOpenAiText(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) {
    throw new AiProviderError('invalid_response', 'OpenAI-compatible response shape is invalid');
  }
  const choices = (payload as { choices?: unknown }).choices;
  const content = Array.isArray(choices)
    ? (choices[0] as { message?: { content?: unknown } } | undefined)?.message?.content
    : undefined;
  if (typeof content !== 'string') {
    throw new AiProviderError(
      'invalid_response',
      'OpenAI-compatible provider returned no text content',
    );
  }
  return parseModelJson(content);
}
