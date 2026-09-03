import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Logger, sanitizeString, sanitizeData } from '../src/logger.js';

describe('Dispar Flux Server: ADR 0050 Logger & Sanitization', () => {
  it('redacts sensitive keys from context objects (secrets, tokens, passwords)', () => {
    const context = {
      password: 'SuperSecretPassword123!',
      token: 'jwt.token.value',
      tokenHash: 'sha256hash123',
      secret: 'my-ultra-secret',
      operationalKey: 'c8f3992a0e4b8',
      recoveryKey: 'rec_key_99',
      apiKey: 'sk-live-123456',
      claimCode: 'CLAIM-CODE-1',
      // Non-sensitive operational keys should be preserved
      action: 'auth.login',
      status: 'success',
      latencyMs: 42,
    };

    const sanitized = sanitizeData(context) as Record<string, unknown>;

    assert.equal(sanitized['password'], '[REDACTED]');
    assert.equal(sanitized['token'], '[REDACTED]');
    assert.equal(sanitized['tokenHash'], '[REDACTED]');
    assert.equal(sanitized['secret'], '[REDACTED]');
    assert.equal(sanitized['operationalKey'], '[REDACTED]');
    assert.equal(sanitized['recoveryKey'], '[REDACTED]');
    assert.equal(sanitized['apiKey'], '[REDACTED]');
    assert.equal(sanitized['claimCode'], '[REDACTED]');

    // Preserved keys
    assert.equal(sanitized['action'], 'auth.login');
    assert.equal(sanitized['status'], 'success');
    assert.equal(sanitized['latencyMs'], 42);
  });

  it('redacts message bodies, templates and rendered messages (ADR 0050)', () => {
    const context = {
      content: 'Olá fulano, seu código de confirmação é 4920!',
      body: 'Segue o boleto em anexo.',
      messageBody: 'Corpo sigiloso da mensagem.',
      messageTemplate: 'Olá {{1}}, bem-vindo à nossa loja!',
      renderedMessage: 'Olá Maria, bem-vindo à nossa loja!',
      // Non-sensitive keys
      campaignId: 'camp-42',
      direction: 'outbound',
    };

    const sanitized = sanitizeData(context) as Record<string, unknown>;

    assert.equal(sanitized['content'], '[REDACTED]');
    assert.equal(sanitized['body'], '[REDACTED]');
    assert.equal(sanitized['messageBody'], '[REDACTED]');
    assert.equal(sanitized['messageTemplate'], '[REDACTED]');
    assert.equal(sanitized['renderedMessage'], '[REDACTED]');

    assert.equal(sanitized['campaignId'], 'camp-42');
    assert.equal(sanitized['direction'], 'outbound');
  });

  it('redacts phone numbers from structured fields and free text', () => {
    // Structured field
    const context = {
      phone: '+5511999998888',
      normalizedPhone: '5511999998888',
      rawPhone: '(11) 99999-8888',
      jid: '5511999998888@s.whatsapp.net',
    };

    const sanitized = sanitizeData(context) as Record<string, unknown>;
    assert.equal(sanitized['phone'], '[REDACTED]');
    assert.equal(sanitized['normalizedPhone'], '[REDACTED]');
    assert.equal(sanitized['rawPhone'], '[REDACTED]');
    assert.equal(sanitized['jid'], '[REDACTED]');

    // Free text phone redaction
    const textWithPhones = 'Falha ao enviar para +5511999998888 ou (21) 98765-4321 no job 123';
    const sanitizedText = sanitizeString(textWithPhones);
    assert.ok(!sanitizedText.includes('999998888'));
    assert.ok(!sanitizedText.includes('98765-4321'));
    assert.ok(sanitizedText.includes('[REDACTED_PHONE]'));
    assert.ok(sanitizedText.includes('job 123'));
  });

  it('redacts Bearer tokens and email addresses in free text and errors', () => {
    const text = 'Authorization failed for Bearer eyJhbGciOiJIUzI1NiJ9.test and user admin@example.com';
    const sanitized = sanitizeString(text);

    assert.ok(!sanitized.includes('eyJhbGciOiJIUzI1NiJ9'));
    assert.ok(!sanitized.includes('admin@example.com'));
    assert.ok(sanitized.includes('Bearer [REDACTED]'));
    assert.ok(sanitized.includes('[REDACTED_EMAIL]'));
  });

  it('outputs valid JSON log format adhering to structured observability requirements', () => {
    const logs: string[] = [];
    const logger = new Logger({
      level: 'debug',
      format: 'json',
      output: (line) => logs.push(line),
    });

    logger.info('Processing campaign batch', {
      campaignId: 'camp-1',
      totalCount: 100,
      token: 'secret-token-value',
    });

    assert.equal(logs.length, 1);
    const parsed = JSON.parse(logs[0]!);

    assert.equal(parsed.level, 'info');
    assert.equal(parsed.message, 'Processing campaign batch');
    assert.ok(parsed.timestamp);
    assert.equal(parsed.context.campaignId, 'camp-1');
    assert.equal(parsed.context.totalCount, 100);
    assert.equal(parsed.context.token, '[REDACTED]');
  });

  it('supports child logger with bound sanitized context', () => {
    const logs: string[] = [];
    const rootLogger = new Logger({
      level: 'debug',
      format: 'json',
      output: (line) => logs.push(line),
    });

    const child = rootLogger.child({
      subsystem: 'worker',
      secret: 'child-secret',
    });

    child.warn('High latency detected', { latencyMs: 850 });

    assert.equal(logs.length, 1);
    const parsed = JSON.parse(logs[0]!);
    assert.equal(parsed.level, 'warn');
    assert.equal(parsed.context.subsystem, 'worker');
    assert.equal(parsed.context.secret, '[REDACTED]');
    assert.equal(parsed.context.latencyMs, 850);
  });
});
