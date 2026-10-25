import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  EnterpriseLicenseManager,
  EnterpriseCloudBackupProvider,
  EnterpriseMultiSessionCoordinator,
  EnterprisePlugin,
} from '../src/index.js';

describe('Dispar Flux Enterprise Extensions (ADR 0009 & ADR 0052)', () => {
  it('generates and validates signed enterprise license tokens', () => {
    const manager = new EnterpriseLicenseManager('test-secret-salt-key-1234567890');
    const token = manager.generateLicenseToken('org_acme_corp', {
      maxConnections: 10,
      maxFunnels: 20,
    });

    assert.ok(typeof token === 'string' && token.includes('.'));
    const validation = manager.validateLicenseToken(token);

    assert.equal(validation.valid, true);
    assert.equal(validation.edition, 'enterprise');
    assert.equal(validation.organizationId, 'org_acme_corp');
    assert.equal(validation.features.maxConnections, 10);
    assert.equal(validation.features.maxFunnels, 20);
    assert.equal(validation.features.multiConnection, true);
    assert.equal(validation.features.multiFunnel, true);
  });

  it('rejects tampered or forged license tokens', () => {
    const manager = new EnterpriseLicenseManager('test-secret-salt-key-1234567890');
    const validToken = manager.generateLicenseToken('org_legit');
    const [data] = validToken.split('.');
    const forgedToken = `${data}.tampered_signature_bytes`;

    const validation = manager.validateLicenseToken(forgedToken);
    assert.equal(validation.valid, false);
    assert.equal(validation.error, 'Invalid license signature');
  });

  it('manages multi-session coordination across multiple WhatsApp accounts', () => {
    const coordinator = new EnterpriseMultiSessionCoordinator();
    assert.equal(coordinator.getActiveSessionCount(), 0);

    coordinator.registerSession({
      connectionId: 'conn_sdr_1',
      name: 'WhatsApp SDR Prospecção',
      status: 'connected',
      phoneNumber: '+5511999990001',
      isDefault: true,
    });

    coordinator.registerSession({
      connectionId: 'conn_sdr_2',
      name: 'WhatsApp Suporte',
      status: 'connected',
      phoneNumber: '+5511999990002',
      isDefault: false,
    });

    assert.equal(coordinator.listSessions().length, 2);
    assert.equal(coordinator.getActiveSessionCount(), 2);

    coordinator.updateSessionStatus('conn_sdr_2', 'disconnected');
    assert.equal(coordinator.getActiveSessionCount(), 1);

    coordinator.removeSession('conn_sdr_1');
    assert.equal(coordinator.listSessions().length, 1);
  });

  it('executes cloud backup upload pipeline and verifies hash', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-cloud-backup-'));
    const testFile = path.join(tempDir, 'backup-2026-test.enc');
    fs.writeFileSync(testFile, 'ENCRYPTED_BACKUP_PAYLOAD_BYTES');

    const provider = new EnterpriseCloudBackupProvider({
      provider: 'custom',
      bucket: 'test-bucket',
    });

    const result = await provider.uploadBackup(testFile, 'org_acme');
    assert.equal(result.success, true);
    assert.ok(result.destination.includes('org_acme/backup-2026-test.enc'));
    assert.ok(result.sha256.length === 64);
    assert.equal(result.bytesUploaded, Buffer.from('ENCRYPTED_BACKUP_PAYLOAD_BYTES').length);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('initializes EnterprisePlugin conforming to DisparFluxPlugin contract', () => {
    const plugin = new EnterprisePlugin();
    assert.equal(plugin.name, '@dispar-flux/enterprise');
    assert.equal(plugin.editionRequired, 'enterprise');

    let broadcastCalled = false;
    plugin.onServerStart({
      edition: 'enterprise',
      dataDir: '/tmp',
      broadcast: (event, payload) => {
        if (event === 'enterprise:status' && payload.enabled) {
          broadcastCalled = true;
        }
      },
    });

    assert.equal(broadcastCalled, true);
  });
});
