export const REDACTED_VALUE = '[REDACTED]';

const SENSITIVE_KEYS = new Set([
  'authorization',
  'cookie',
  'setcookie',
  'supabaseanonkey',
  'supabaseservicerolekey',
  'geminiapikey',
  'circleapikey',
  'circleentitysecret',
  'entitysecretciphertext',
  'privatekey',
  'walletprivatekey',
  'signedurl',
  'signedurls',
  'reporttitle',
  'reportcontent',
  'reportimpact',
  'reportreproduction',
  'reproduction',
  'reproductionsteps',
  'title',
  'content',
  'impact',
]);

const SIGNED_URL_PATTERN = /[?&](?:token|signature|sig|x-amz-signature|x-goog-signature|expires)=/i;

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(normalizeKey(key));
}

function redactValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') {
    return SIGNED_URL_PATTERN.test(value) ? REDACTED_VALUE : value;
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    value === undefined
  ) {
    return value;
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, seen));
  }

  const redacted: Record<string, unknown> = {};

  for (const [key, entryValue] of Object.entries(value)) {
    redacted[key] = isSensitiveKey(key) ? REDACTED_VALUE : redactValue(entryValue, seen);
  }

  return redacted;
}

export function redactSensitiveData(value: unknown): unknown {
  return redactValue(value, new WeakSet<object>());
}
