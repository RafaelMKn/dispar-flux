import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createTestContext } from './test-helper.js';
import { AuthService } from '../src/auth-service.js';

import { fileURLToPath } from 'node:url';

describe('Emergency CLI Recovery (bin/dispar-cli.js) (ADR 0029, 0047)', () => {
  const cliPath = fileURLToPath(new URL('../../../bin/dispar-cli.js', import.meta.url));

  it('generates emergency login token, resets password, and approves device via CLI', () => {
    const ctx = createTestContext();
    try {
      const auth = new AuthService(ctx.db, { dataDir: ctx.dataDir });

      // Claim installation to create owner
      const bootToken = auth.claimService.getBootClaimToken()!;
      const claimResult = auth.claim({
        claimCode: bootToken,
        organizationName: 'CLI Org',
        ownerName: 'Admin Host',
        ownerEmail: 'admin@host.com',
        password: 'InitialPassword123!',
        operationalTimezone: 'America/Sao_Paulo',
      });

      const dbPath = path.join(ctx.dataDir, 'dispar-flux.sqlite');

      // 1. Test CLI claim-status
      const statusOutput = execFileSync(process.execPath, [cliPath, 'claim-status', '--db', dbPath, '--data-dir', ctx.dataDir], {
        encoding: 'utf-8',
      });
      assert.ok(statusOutput.includes('Claimed:    YES'));

      // 2. Test CLI emergency-login
      const emergencyOutput = execFileSync(
        process.execPath,
        [cliPath, 'emergency-login', '--email', 'admin@host.com', '--db', dbPath],
        { encoding: 'utf-8' }
      );

      assert.ok(emergencyOutput.includes('EMERGENCY OWNER ACCESS RECOVERY'));
      assert.ok(emergencyOutput.includes('admin@host.com'));

      // Extract emergency token from CLI output
      const tokenMatch = emergencyOutput.match(/Emergency Token:\s+([a-f0-9]{64})/);
      assert.ok(tokenMatch && tokenMatch[1], 'Emergency token must be printed in output');
      const emergencyToken = tokenMatch[1];

      // Validate that this emergency token authenticates the owner immediately
      const sessionCtx = auth.authenticate(emergencyToken);
      assert.equal(sessionCtx.member.email, 'admin@host.com');
      assert.equal(sessionCtx.member.role, 'owner');
      assert.equal(sessionCtx.device.deviceIdentifier, 'cli-emergency-recovery');
      assert.equal(sessionCtx.device.isApproved, true);

      // 3. Test CLI reset-password
      const resetOutput = execFileSync(
        process.execPath,
        [cliPath, 'reset-password', '--email', 'admin@host.com', '--password', 'NewEmergencyPassword2026!', '--db', dbPath],
        { encoding: 'utf-8' }
      );
      assert.ok(resetOutput.includes('Successfully reset password for member "admin@host.com"'));

      // Logging in with old password now fails
      assert.throws(() =>
        auth.login({
          email: 'admin@host.com',
          password: 'InitialPassword123!',
          deviceFingerprint: 'cli-emergency-recovery',
        })
      );

      // Logging in with new password succeeds
      const newLogin = auth.login({
        email: 'admin@host.com',
        password: 'NewEmergencyPassword2026!',
        deviceFingerprint: 'cli-emergency-recovery',
      });
      assert.ok(newLogin.token);

      // 4. Test CLI approve-device
      // Create an unapproved device attempt
      const attempt = auth.login({
        email: 'admin@host.com',
        password: 'NewEmergencyPassword2026!',
        deviceFingerprint: 'unapproved-device-xyz',
      });
      assert.equal(attempt.requiresDeviceApproval, true);

      const approveOutput = execFileSync(
        process.execPath,
        [cliPath, 'approve-device', '--device-id', attempt.deviceId, '--db', dbPath],
        { encoding: 'utf-8' }
      );
      assert.ok(approveOutput.includes('approved successfully'));

      // Subsequent login now succeeds without requiring approval
      const approvedLogin = auth.login({
        email: 'admin@host.com',
        password: 'NewEmergencyPassword2026!',
        deviceFingerprint: 'unapproved-device-xyz',
      });
      assert.ok(approvedLogin.token);
      assert.equal(approvedLogin.requiresDeviceApproval, false);
    } finally {
      ctx.cleanup();
    }
  });
});
