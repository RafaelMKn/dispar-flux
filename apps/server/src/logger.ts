import util from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFormat = 'json' | 'text';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Sensitive property keys to redact (ADR 0050)
const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'token',
  'tokenhash',
  'secret',
  'authorization',
  'cookie',
  'key',
  'operationalkey',
  'operational_key',
  'recoverykey',
  'recovery_key',
  'apikey',
  'api_key',
  'privatekey',
  'private_key',
  'creditcard',
  'cvv',
  'pin',
  'claimcode',
  'claim_code',
  // Message contents & bodies
  'content',
  'body',
  'messagebody',
  'message_body',
  'messagecontent',
  'message_content',
  'messagetemplate',
  'message_template',
  'renderedmessage',
  'rendered_message',
  'text',
  'caption',
  // Phone numbers
  'phone',
  'phonenumber',
  'phone_number',
  'normalizedphone',
  'normalized_phone',
  'rawphone',
  'raw_phone',
  'jid',
]);

// Regular expressions to redact sensitive substrings in free text (ADR 0050)
const BEARER_REGEX = /(Bearer\s+)[A-Za-z0-9._\-~+/]+=*/gi;
const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// E.164 phone numbers and Brazilian local phone numbers
const E164_PHONE_REGEX = /\+[1-9]\d{7,14}\b/g;
const BRAZIL_PHONE_REGEX = /\b(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?(?:9\d{4}|\d{4})[-\s]?\d{4}\b/g;

/**
 * Sanitizes a string by redacting embedded secrets, emails, and phone numbers.
 */
export function sanitizeString(text: string): string {
  return text
    .replace(BEARER_REGEX, '$1[REDACTED]')
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(E164_PHONE_REGEX, '[REDACTED_PHONE]')
    .replace(BRAZIL_PHONE_REGEX, '[REDACTED_PHONE]');
}

/**
 * Recursively redacts sensitive keys, PII, and secrets from objects/arrays/primitives.
 */
export function sanitizeData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  // Handle circular references
  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeString(value.message),
      stack: value.stack ? sanitizeString(value.stack) : undefined,
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeData(item, seen));
  }

  const sanitizedObj: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;

  for (const [k, v] of Object.entries(record)) {
    const lowerKey = k.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(lowerKey)) {
      sanitizedObj[k] = '[REDACTED]';
    } else {
      sanitizedObj[k] = sanitizeData(v, seen);
    }
  }

  return sanitizedObj;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: LogFormat;
  defaultContext?: Record<string, unknown>;
  output?: (line: string, level: LogLevel) => void;
}

export class Logger {
  public level: LogLevel;
  public format: LogFormat;
  private readonly defaultContext: Record<string, unknown>;
  private readonly writeOutput: (line: string, level: LogLevel) => void;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.format = options.format ?? 'json';
    this.defaultContext = options.defaultContext ?? {};
    this.writeOutput =
      options.output ??
      ((line: string, level: LogLevel) => {
        if (level === 'error') {
          process.stderr.write(line + '\n');
        } else {
          process.stdout.write(line + '\n');
        }
      });
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>, error?: unknown): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const sanitizedMsg = sanitizeString(message);
    const mergedContext = { ...this.defaultContext, ...context };
    const sanitizedContext = (sanitizeData(mergedContext) as Record<string, unknown>) ?? {};
    const sanitizedError = error ? (sanitizeData(error) as Record<string, unknown>) : undefined;

    if (this.format === 'json') {
      const payload: Record<string, unknown> = {
        timestamp,
        level,
        message: sanitizedMsg,
      };

      if (Object.keys(sanitizedContext).length > 0) {
        payload['context'] = sanitizedContext;
      }

      if (sanitizedError) {
        payload['error'] = sanitizedError;
      }

      this.writeOutput(JSON.stringify(payload), level);
    } else {
      // Formatted text output
      let line = `[${timestamp}] [${level.toUpperCase()}] ${sanitizedMsg}`;
      if (Object.keys(sanitizedContext).length > 0) {
        line += ` | context: ${util.inspect(sanitizedContext, { breakLength: Infinity, compact: true })}`;
      }
      if (sanitizedError) {
        line += ` | error: ${util.inspect(sanitizedError, { breakLength: Infinity, compact: true })}`;
      }
      this.writeOutput(line, level);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, errorOrContext?: unknown, context?: Record<string, unknown>): void {
    if (errorOrContext instanceof Error) {
      this.log('error', message, context, errorOrContext);
    } else if (typeof errorOrContext === 'object' && errorOrContext !== null) {
      this.log('error', message, { ...(errorOrContext as Record<string, unknown>), ...context });
    } else if (typeof errorOrContext === 'string') {
      this.log('error', message, context, new Error(errorOrContext));
    } else {
      this.log('error', message, context);
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    return new Logger({
      level: this.level,
      format: this.format,
      defaultContext: { ...this.defaultContext, ...bindings },
      output: this.writeOutput,
    });
  }
}

export const logger = new Logger({
  level: (process.env.LOG_LEVEL?.toLowerCase() as LogLevel) || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  format: process.env.LOG_FORMAT === 'text' ? 'text' : 'json',
});
