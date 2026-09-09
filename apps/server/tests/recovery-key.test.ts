import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer, DisparFluxServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import { SanitizedLogger } from '@dispar-flux/security';

describe('Dispar Flux Server: RECOVERY_KEY Fail-Fast & Secrets Management', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-recovery-test-'));
    delete process.env.RECOVERY_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Best effort cleanup
    }
  });

  it('Server fails to start in production when RECOVERY_KEY is missing', async () => {
    delete process.env.RECOVERY_KEY;
    const server = createServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: tempDir,
      nodeEnv: 'production',
    });

    await assert.rejects(
      async () => {
        await server.start();
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'RECOVERY_KEY is mandatory in production');
        return true;
      }
    );

    // Also verify loadConfig fail-fast
    assert.throws(
      () => loadConfig({ nodeEnv: 'production', recoveryKey: undefined }),
      /RECOVERY_KEY is mandatory in production/
    );
  });

  it('Server fails to start in production when RECOVERY_KEY is empty or whitespace only', async () => {
    const emptyKeys = ['', '   ', '\t\n'];

    for (const emptyKey of emptyKeys) {
      const server = createServer({
        port: 0,
        host: '127.0.0.1',
        dataDir: tempDir,
        nodeEnv: 'production',
        recoveryKey: emptyKey,
      });

      await assert.rejects(
        async () => {
          await server.start();
        },
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, 'RECOVERY_KEY is mandatory in production');
          return true;
        }
      );

      assert.throws(
        () => loadConfig({ nodeEnv: 'production', recoveryKey: emptyKey }),
        /RECOVERY_KEY is mandatory in production/
      );
    }
  });

  it("Server fails to start in production when RECOVERY_KEY is 'flux_default_recovery_key_32_bytes_long_!!'", async () => {
    const weakDefault = 'flux_default_recovery_key_32_bytes_long_!!';
    const server = createServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: tempDir,
      nodeEnv: 'production',
      recoveryKey: weakDefault,
    });

    await assert.rejects(
      async () => {
        await server.start();
      },
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'Insecure default RECOVERY_KEY is prohibited in production');
        return true;
      }
    );

    assert.throws(
      () => loadConfig({ nodeEnv: 'production', recoveryKey: weakDefault }),
      /Insecure default RECOVERY_KEY is prohibited in production/
    );
  });

  it('Server fails to start in production when RECOVERY_KEY has < 32 characters', async () => {
    const shortKeys = ['short', '1234567890123456789012345678901']; // 5 and 31 chars

    for (const shortKey of shortKeys) {
      const server = createServer({
        port: 0,
        host: '127.0.0.1',
        dataDir: tempDir,
        nodeEnv: 'production',
        recoveryKey: shortKey,
      });

      await assert.rejects(
        async () => {
          await server.start();
        },
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.equal(err.message, 'RECOVERY_KEY must be at least 32 characters long in production');
          // Ensure secret value is not leaked in the error
          assert.ok(!err.message.includes(shortKey));
          return true;
        }
      );

      assert.throws(
        () => loadConfig({ nodeEnv: 'production', recoveryKey: shortKey }),
        /RECOVERY_KEY must be at least 32 characters long in production/
      );
    }
  });

  it('Server starts in production when valid 32+ char RECOVERY_KEY is provided', async () => {
    const validKey = 'flux_rec_production_secure_key_0123456789abcdef_valid';
    const server = createServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: tempDir,
      nodeEnv: 'production',
      recoveryKey: validKey,
    });

    try {
      const { port, address } = await server.start();
      assert.ok(port > 0);
      assert.ok(address.startsWith('http://127.0.0.1:'));
      assert.equal(server.isRunning, true);
      assert.equal(server.recoveryKey, validKey);

      const healthRes = await fetch(`${server.url}/health`);
      assert.equal(healthRes.status, 200);
    } finally {
      await server.stop();
    }

    const config = loadConfig({ nodeEnv: 'production', recoveryKey: validKey });
    assert.equal(config.recoveryKey, validKey);
  });

  it('Server logs warning in development when key is omitted', async () => {
    delete process.env.RECOVERY_KEY;

    const warnings: string[] = [];
    const customLogger = new SanitizedLogger('TestLogger');
    const originalWarn = customLogger.warn.bind(customLogger);
    customLogger.warn = (message: string, meta?: Record<string, unknown>) => {
      warnings.push(message);
      return originalWarn(message, meta);
    };

    const server = new DisparFluxServer({
      port: 0,
      host: '127.0.0.1',
      dataDir: tempDir,
      nodeEnv: 'development',
      logger: customLogger,
    });

    // Warning logged in constructor
    assert.ok(
      warnings.some((w) =>
        w.includes('No RECOVERY_KEY provided, using ephemeral/development key. Do NOT use in production.')
      ),
      'Must log warning upon construction when key is omitted'
    );

    // Verify auto-generated key is secure (length >= 32)
    assert.ok(server.recoveryKey && server.recoveryKey.length >= 32);

    // Verify key value is never revealed in any warning log
    for (const w of warnings) {
      assert.ok(!w.includes(server.recoveryKey), 'Key value must never be logged');
    }

    // Start server to verify start() also safely warns and completes boot
    try {
      const { port } = await server.start();
      assert.ok(port > 0);
      assert.equal(server.isRunning, true);
    } finally {
      await server.stop();
    }
  });
});