import { DisconnectReason } from '@whiskeysockets/baileys';

export interface BackoffOptions {
  initialDelayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export const DEFAULT_BACKOFF_OPTIONS: Required<BackoffOptions> = {
  initialDelayMs: 1000,
  factor: 2,
  maxDelayMs: 30000,
  jitter: false,
};

/**
 * Calculates exponential backoff delay for reconnection attempts.
 * attempt is 0-indexed (attempt 0 = initial delay).
 */
export function calculateBackoff(attempt: number, options?: BackoffOptions): number {
  const initialDelayMs = options?.initialDelayMs ?? DEFAULT_BACKOFF_OPTIONS.initialDelayMs;
  const factor = options?.factor ?? DEFAULT_BACKOFF_OPTIONS.factor;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_BACKOFF_OPTIONS.maxDelayMs;
  const jitter = options?.jitter ?? DEFAULT_BACKOFF_OPTIONS.jitter;

  const safeAttempt = Math.max(0, attempt);
  const baseDelay = Math.min(initialDelayMs * Math.pow(factor, safeAttempt), maxDelayMs);

  if (jitter) {
    // Add jitter between 0% and 20%
    const jitterAmount = baseDelay * 0.2 * Math.random();
    return Math.floor(baseDelay + jitterAmount);
  }

  return Math.floor(baseDelay);
}

export type DisconnectCategory =
  | 'logged_out'
  | 'restart_required'
  | 'temporary_network'
  | 'conflict'
  | 'unknown';

/**
 * Classifies disconnect error to determine reconnection behavior.
 */
export function classifyDisconnectReason(statusCode?: number, errorCode?: string): DisconnectCategory {
  if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
    return 'logged_out';
  }

  if (statusCode === DisconnectReason.restartRequired || statusCode === 515) {
    return 'restart_required';
  }

  if (statusCode === DisconnectReason.connectionReplaced || statusCode === 440) {
    return 'conflict';
  }

  if (
    statusCode === DisconnectReason.timedOut ||
    statusCode === DisconnectReason.connectionLost ||
    statusCode === DisconnectReason.connectionClosed ||
    statusCode === 408 ||
    statusCode === 428 ||
    statusCode === 500 ||
    errorCode === 'ECONNRESET' ||
    errorCode === 'ETIMEDOUT' ||
    errorCode === 'ENOTFOUND' ||
    errorCode === 'EAI_AGAIN' ||
    errorCode === 'EHOSTUNREACH'
  ) {
    return 'temporary_network';
  }

  return 'unknown';
}

export function isPermanentDisconnect(statusCode?: number, errorCode?: string): boolean {
  const category = classifyDisconnectReason(statusCode, errorCode);
  return category === 'logged_out' || category === 'conflict';
}

export function isImmediateRestart(statusCode?: number): boolean {
  return classifyDisconnectReason(statusCode) === 'restart_required';
}

export function isTemporaryNetworkError(statusCode?: number, errorCode?: string): boolean {
  const category = classifyDisconnectReason(statusCode, errorCode);
  return category === 'temporary_network' || category === 'unknown';
}
