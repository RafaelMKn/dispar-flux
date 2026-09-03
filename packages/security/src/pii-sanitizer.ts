/**
 * PII Sanitization filter for application logs (ADR 0050: Observabilidade sem conteúdo ou PII).
 * Redacts phones, names, messages, and secrets while preserving technical identifiers.
 */

// Matches Brazilian phone numbers in varied formats: +55 (11) 98888-7777, +5511988887777, 11988887777, (11) 98888-7777, 1188887777
const BRAZILIAN_PHONE_REGEX = /(?:\+?55\s?)?(?:\(?([1-9][0-9])\)?\s?)(?:9\s?)?([0-9]{4})[-.\s]?([0-9]{4})\b/g;

// Matches general E.164 phone numbers with + and 7 to 15 digits
const E164_PHONE_REGEX = /\+[1-9][0-9]{6,14}\b/g;

// Matches email addresses
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

// Sensitive field names that should be redacted in objects
const SENSITIVE_PHONE_KEYS = new Set([
  'phone',
  'phonenumber',
  'normalizedphone',
  'normalized_phone',
  'phone_e164',
  'recipient',
  'targetphone',
]);

const SENSITIVE_NAME_KEYS = new Set([
  'name',
  'ownername',
  'owner_name',
  'contactname',
  'contact_name',
  'membername',
  'member_name',
  'fullname',
  'full_name',
]);

const SENSITIVE_MESSAGE_KEYS = new Set([
  'content',
  'message',
  'messagetemplate',
  'message_template',
  'renderedmessage',
  'rendered_message',
  'renderedtext',
  'rendered_text',
  'body',
  'caption',
  'notes',
]);

const SENSITIVE_SECRET_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'rawtoken',
  'raw_token',
  'secret',
  'claimcode',
  'claim_code',
  'recoverykey',
  'recovery_key',
  'hashkey',
  'hash_key',
  'auth_state_json',
]);

/**
 * Sanitizes a string, redacting phone numbers, emails, and sensitive patterns.
 */
export function sanitizeLogString(str: string): string {
  if (!str || typeof str !== 'string') return str;

  return str
    .replace(BRAZILIAN_PHONE_REGEX, '[REDACTED_PHONE]')
    .replace(E164_PHONE_REGEX, '[REDACTED_PHONE]')
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]');
}

/**
 * Recursively sanitizes an object or array, redacting PII, message contents, and secrets.
 */
export function sanitizeLogObject<T = unknown>(input: T, seen = new WeakSet<object>()): T {
  if (input === null || input === undefined) {
    return input;
  }

  if (typeof input === 'string') {
    return sanitizeLogString(input) as unknown as T;
  }

  if (typeof input !== 'object') {
    return input;
  }

  if (input instanceof Date || input instanceof RegExp) {
    return input;
  }

  if (input instanceof Error) {
    const sanitizedError: Record<string, unknown> = {
      name: input.name,
      message: sanitizeLogString(input.message),
      stack: input.stack ? sanitizeLogString(input.stack) : undefined,
    };
    for (const [key, value] of Object.entries(input)) {
      sanitizedError[key] = sanitizeLogObject(value, seen);
    }
    return sanitizedError as unknown as T;
  }

  if (seen.has(input)) {
    return '[Circular]' as unknown as T;
  }
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeLogObject(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const lowerKey = key.toLowerCase().replace(/[-_]/g, '');

    if (SENSITIVE_SECRET_KEYS.has(lowerKey)) {
      result[key] = '[REDACTED_SECRET]';
    } else if (SENSITIVE_PHONE_KEYS.has(lowerKey)) {
      result[key] = '[REDACTED_PHONE]';
    } else if (SENSITIVE_NAME_KEYS.has(lowerKey)) {
      result[key] = '[REDACTED_NAME]';
    } else if (SENSITIVE_MESSAGE_KEYS.has(lowerKey)) {
      result[key] = '[REDACTED_MESSAGE]';
    } else if (typeof value === 'string') {
      result[key] = sanitizeLogString(value);
    } else {
      result[key] = sanitizeLogObject(value, seen);
    }
  }

  return result as unknown as T;
}

/**
 * Structured log entry adhering to ADR 0050.
 */
export interface SanitizedLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  context?: Record<string, unknown>;
}

export class SanitizedLogger {
  constructor(private readonly component = 'DisparFlux') {}

  info(message: string, meta?: Record<string, unknown>): SanitizedLogEntry {
    return this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): SanitizedLogEntry {
    return this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): SanitizedLogEntry {
    return this.log('error', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): SanitizedLogEntry {
    return this.log('debug', message, meta);
  }

  log(level: 'info' | 'warn' | 'error' | 'debug', message: string, meta?: Record<string, unknown>): SanitizedLogEntry {
    const entry: SanitizedLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: sanitizeLogString(message),
      context: meta ? sanitizeLogObject(meta) : undefined,
    };

    const formatted = `[${entry.timestamp}] [${level.toUpperCase()}] [${this.component}] ${entry.message}`;
    if (level === 'error') {
      // eslint-disable-next-line no-console
      console.error(formatted, entry.context ?? '');
    } else if (level === 'warn') {
      // eslint-disable-next-line no-console
      console.warn(formatted, entry.context ?? '');
    } else {
      // eslint-disable-next-line no-console
      console.log(formatted, entry.context ?? '');
    }

    return entry;
  }
}
