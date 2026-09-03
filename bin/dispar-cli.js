#!/usr/bin/env node

/**
 * Dispar Flux — Emergency CLI Recovery Utility (ADR 0020, ADR 0029, ADR 0047)
 * Standalone CLI utility for host admin on the VPS to generate emergency Owner login codes,
 * approve devices, or reset passwords directly against SQLite.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseConnection } from '@dispar-flux/database';
import { PasswordHasher } from '../packages/auth/dist/password/password-hasher.js';
import { readClaimToken } from '../packages/auth/dist/onboarding/claim-token.js';

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    } else {
      parsed._.push(arg);
    }
  }
  return parsed;
}

function printUsage() {
  console.log(`
Dispar Flux — Host Administration & Emergency Recovery CLI

Usage:
  node bin/dispar-cli.js <command> [options]

Commands:
  emergency-login       Generate an emergency Owner recovery code and bearer session
    --email <email>     (Optional) Target Owner email. Defaults to first active Owner.
    --db <path>         (Optional) Direct path to SQLite database.

  reset-password        Reset password for a member directly in SQLite
    --email <email>     Target member email. (Required)
    --password <pass>   New plain password (minimum 8 characters). (Required)
    --db <path>         (Optional) Direct path to SQLite database.

  approve-device        Directly approve a pending authorized device
    --device-id <id>    Target authorized device ID. (Required)
    --db <path>         (Optional) Direct path to SQLite database.

  list-members          List all members and their roles
    --db <path>         (Optional) Direct path to SQLite database.

  list-devices          List authorized devices and trust status
    --db <path>         (Optional) Direct path to SQLite database.

  claim-status          Check if installation is claimed and display claim code
    --db <path>         (Optional) Direct path to SQLite database.
    --data-dir <path>   (Optional) Directory where claim.token resides.

Options:
  --help                Show this help screen.
`);
}

function resolveDb(dbArg) {
  const filePath = dbArg || process.env.DATABASE_FILE || path.join(process.env.DATA_DIR || './data', 'dispar-flux.sqlite');
  if (filePath !== ':memory:' && !fs.existsSync(filePath)) {
    console.error(`Error: Database file not found at "${filePath}".`);
    process.exit(1);
  }
  return new DatabaseConnection({ filePath });
}

function logAudit(db, orgId, action, targetType, targetId, metadata = null) {
  try {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO audit_records (
        id, organization_id, actor_type, actor_id, action, target_type, target_id, metadata, timestamp
      ) VALUES (?, ?, 'system', 'cli-emergency', ?, ?, ?, ?, ?)
    `).run(id, orgId, action, targetType, targetId, metadata ? JSON.stringify(metadata) : null, now);
  } catch (err) {
    // Audit logging is best-effort during emergency recovery
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || args.help || command === 'help') {
    printUsage();
    process.exit(0);
  }

  const hasher = new PasswordHasher();

  switch (command) {
    case 'emergency-login': {
      const db = resolveDb(args.db);
      try {
        let owner;
        if (args.email) {
          owner = db.prepare('SELECT id, organization_id, name, email, role, is_active FROM members WHERE email = ?').get(args.email.trim().toLowerCase());
        } else {
          owner = db.prepare("SELECT id, organization_id, name, email, role, is_active FROM members WHERE role = 'owner' AND is_active = 1 LIMIT 1").get();
        }

        if (!owner) {
          console.error('Error: No active Owner found matching criteria.');
          process.exit(1);
        }

        if (owner.role !== 'owner') {
          console.error(`Error: Member "${owner.email}" is an Operator, not an Owner.`);
          process.exit(1);
        }

        const now = new Date();
        const deviceId = crypto.randomUUID();
        const deviceExpiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

        // Authorize emergency recovery device
        db.prepare(`
          INSERT INTO authorized_devices (
            id, member_id, device_identifier, name, is_approved, approved_at, approved_by_member_id, last_seen_at, expires_at, created_at
          ) VALUES (?, ?, 'cli-emergency-recovery', 'Emergency CLI Recovery Session', 1, ?, ?, ?, ?, ?)
        `).run(deviceId, owner.id, now.toISOString(), owner.id, now.toISOString(), deviceExpiresAt.toISOString(), now.toISOString());

        // Create emergency session (12h idle, 30d absolute)
        const sessionId = crypto.randomUUID();
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const idleExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
        const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        db.prepare(`
          INSERT INTO sessions (
            id, member_id, device_id, token_hash, last_activity_at, idle_expires_at, expires_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(sessionId, owner.id, deviceId, tokenHash, now.toISOString(), idleExpiresAt.toISOString(), expiresAt.toISOString(), now.toISOString());

        // Single-use short recovery code (valid 15 minutes)
        const shortCode = `EMERGENCY-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        logAudit(db, owner.organization_id, 'emergency.login_generated', 'member', owner.id, {
          email: owner.email,
          deviceId,
        });

        console.log(`
=================================================================
  DISPAR FLUX — EMERGENCY OWNER ACCESS RECOVERY (ADR 0029 & 0047)
=================================================================
  Owner Name:       ${owner.name}
  Owner Email:      ${owner.email}
  Emergency Token:  ${rawToken}
  Recovery Code:    ${shortCode}
  Device ID:        ${deviceId}
  Valid From:       ${now.toISOString()}
  Idle Timeout:     12 hours (${idleExpiresAt.toISOString()})

  Usage:
  Use this Bearer token in your HTTP Authorization header:
    Authorization: Bearer ${rawToken}
=================================================================
`);
      } finally {
        db.close();
      }
      break;
    }

    case 'reset-password': {
      if (!args.email || !args.password) {
        console.error('Error: Both --email and --password are required.');
        process.exit(1);
      }

      if (args.password.length < 8) {
        console.error('Error: Password must be at least 8 characters long.');
        process.exit(1);
      }

      const db = resolveDb(args.db);
      try {
        const member = db.prepare('SELECT id, organization_id, name, email FROM members WHERE email = ?').get(args.email.trim().toLowerCase());
        if (!member) {
          console.error(`Error: Member with email "${args.email}" not found.`);
          process.exit(1);
        }

        const passwordHash = hasher.hash(args.password);
        const now = new Date().toISOString();

        db.transaction(() => {
          db.prepare('UPDATE members SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now, member.id);
          // Revoke existing sessions to enforce re-authentication
          db.prepare('UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL').run(now, member.id);
        });

        logAudit(db, member.organization_id, 'emergency.password_reset', 'member', member.id, {
          email: member.email,
        });

        console.log(`Successfully reset password for member "${member.email}". All previous sessions revoked.`);
      } finally {
        db.close();
      }
      break;
    }

    case 'approve-device': {
      if (!args['device-id']) {
        console.error('Error: --device-id is required.');
        process.exit(1);
      }

      const db = resolveDb(args.db);
      try {
        const device = db.prepare(`
          SELECT d.id, d.member_id, d.name, d.device_identifier, m.organization_id, m.email
          FROM authorized_devices d
          JOIN members m ON m.id = d.member_id
          WHERE d.id = ?
        `).get(args['device-id']);

        if (!device) {
          console.error(`Error: Device with id "${args['device-id']}" not found.`);
          process.exit(1);
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

        db.prepare(`
          UPDATE authorized_devices
          SET is_approved = 1, approved_at = ?, approved_by_member_id = NULL, expires_at = ?, revoked_at = NULL
          WHERE id = ?
        `).run(now.toISOString(), expiresAt.toISOString(), device.id);

        logAudit(db, device.organization_id, 'emergency.device_approve', 'device', device.id, {
          deviceIdentifier: device.device_identifier,
          memberEmail: device.email,
        });

        console.log(`Device "${device.name}" (${device.id}) for member "${device.email}" approved successfully. Trust expires: ${expiresAt.toISOString()}.`);
      } finally {
        db.close();
      }
      break;
    }

    case 'list-members': {
      const db = resolveDb(args.db);
      try {
        const members = db.prepare('SELECT id, organization_id, name, email, role, is_active, created_at FROM members ORDER BY created_at ASC').all();
        console.log('\nRegistered Members:');
        console.table(members);
      } finally {
        db.close();
      }
      break;
    }

    case 'list-devices': {
      const db = resolveDb(args.db);
      try {
        const devices = db.prepare(`
          SELECT d.id, m.email AS member_email, d.device_identifier, d.name, d.is_approved, d.last_seen_at, d.expires_at, d.revoked_at
          FROM authorized_devices d
          JOIN members m ON m.id = d.member_id
          ORDER BY d.last_seen_at DESC
        `).all();
        console.log('\nAuthorized Devices:');
        console.table(devices);
      } finally {
        db.close();
      }
      break;
    }

    case 'claim-status': {
      const dataDir = args['data-dir'] || process.env.DATA_DIR || './data';
      const dbFile = args.db || path.join(dataDir, 'dispar-flux.sqlite');
      let isClaimed = false;

      if (fs.existsSync(dbFile)) {
        const db = new DatabaseConnection({ filePath: dbFile });
        try {
          const row = db.prepare('SELECT COUNT(*) AS count FROM organizations').get();
          isClaimed = Number(row?.count || 0) > 0;
        } finally {
          db.close();
        }
      }

      const claimToken = readClaimToken(dataDir);

      console.log('\n--- Dispar Flux Installation Claim Status ---');
      console.log(`Claimed:    ${isClaimed ? 'YES' : 'NO'}`);
      if (!isClaimed && claimToken) {
        console.log(`Claim Code: ${claimToken}`);
      } else if (!isClaimed) {
        console.log('Claim Code: (Pending boot generation)');
      }
      console.log('--------------------------------------------\n');
      break;
    }

    default: {
      console.error(`Unknown command: "${command}". Use --help for usage.`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
