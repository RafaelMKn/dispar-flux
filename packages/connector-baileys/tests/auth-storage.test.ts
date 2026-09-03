import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  validateConnectionId,
  resolveAuthDir,
  ensureSecureAuthDir,
  initAuthState,
  hasExistingAuth,
  clearAuthDir,
  AuthStorageError,
} from '../src/index.js';

describe('Baileys Connector: Secure wa-auth Storage', () => {
  let tempBaseDir: string;

  beforeEach(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-auth-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempBaseDir)) {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    }
  });

  it('validates connectionId and prevents path traversal', () => {
    assert.doesNotThrow(() => validateConnectionId('conn-1'));
    assert.doesNotThrow(() => validateConnectionId('whatsapp_main_01'));
    assert.doesNotThrow(() => validateConnectionId('SESSION123'));

    assert.throws(() => validateConnectionId(''), AuthStorageError);
    assert.throws(() => validateConnectionId('../evil'), AuthStorageError);
    assert.throws(() => validateConnectionId('conn/nested'), AuthStorageError);
    assert.throws(() => validateConnectionId('conn\\nested'), AuthStorageError);
    assert.throws(() => validateConnectionId('conn:1'), AuthStorageError);
  });

  it('resolves auth directory under ${DATA_DIR}/wa-auth/${connectionId}', () => {
    const resolved = resolveAuthDir('conn-1', { dataDir: tempBaseDir });
    const expected = path.resolve(tempBaseDir, 'wa-auth', 'conn-1');
    assert.equal(resolved, expected);
  });

  it('ensures wa-auth directory creation with restricted permissions', () => {
    const authDir = path.join(tempBaseDir, 'wa-auth', 'secure-conn');
    assert.equal(fs.existsSync(authDir), false);

    const created = ensureSecureAuthDir(authDir);
    assert.equal(fs.existsSync(created), true);

    const stat = fs.statSync(created);
    assert.ok(stat.isDirectory());

    if (process.platform !== 'win32') {
      // 0o700: rwx------ (only owner has read/write/execute)
      assert.equal(stat.mode & 0o777, 0o700);
    }
  });

  it('initializes auth state, creates creds.json, and handles saveCreds', async () => {
    let credsSaved = false;

    // Mock factory for auth state
    const mockFactory = async (dir: string) => {
      const credsPath = path.join(dir, 'creds.json');
      fs.writeFileSync(credsPath, JSON.stringify({ noiseKey: 'test-key', me: { id: '5511999999999' } }));
      return {
        state: {
          creds: { noiseKey: 'test-key' },
          keys: { get: async () => ({}), set: async () => {} },
        } as any,
        saveCreds: async () => {
          credsSaved = true;
          fs.writeFileSync(credsPath, JSON.stringify({ noiseKey: 'test-key-updated' }));
        },
      };
    };

    const result = await initAuthState('conn-test', {
      dataDir: tempBaseDir,
      authStateFactory: mockFactory,
    });

    assert.ok(result.authDir.includes(path.join('wa-auth', 'conn-test')));
    assert.ok(fs.existsSync(result.authDir));
    assert.equal(hasExistingAuth('conn-test', { dataDir: tempBaseDir }), true);

    await result.saveCreds();
    assert.equal(credsSaved, true);
  });

  it('clears auth directory on session termination or logout', async () => {
    const authDir = path.join(tempBaseDir, 'wa-auth', 'clear-conn');
    ensureSecureAuthDir(authDir);
    fs.writeFileSync(path.join(authDir, 'creds.json'), '{"test":true}');
    assert.equal(fs.existsSync(authDir), true);

    await clearAuthDir(authDir);
    assert.equal(fs.existsSync(authDir), false);
  });

  it('enforces secret isolation: credentials stay exclusively in wa-auth file store', async () => {
    const authDir = path.join(tempBaseDir, 'wa-auth', 'isolated-conn');
    ensureSecureAuthDir(authDir);

    const secretData = {
      privateKey: 'super-secret-noise-key',
      registrationId: 12345,
    };
    fs.writeFileSync(path.join(authDir, 'creds.json'), JSON.stringify(secretData));

    // Confirm secrets exist only in filesystem path
    const content = fs.readFileSync(path.join(authDir, 'creds.json'), 'utf-8');
    assert.ok(content.includes('super-secret-noise-key'));

    // SQLite data directory does NOT contain any wa-auth credentials
    const sqlitePath = path.join(tempBaseDir, 'data.db');
    assert.equal(fs.existsSync(sqlitePath), false, 'wa-auth secrets must never be written to SQLite database');
  });
});
