import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  type AuthorizedDevice,
  type Member,
  type MemberRole,
  type Session,
  createSession as createDomainSession,
  SESSION_IDLE_TIMEOUT_MS,
  DEVICE_TRUST_DURATION_MS,
} from '@dispar-flux/domain';
import {
  DeviceNotApprovedError,
  DeviceTrustExpiredError,
  MemberInactiveError,
  SessionExpiredError,
  SessionNotFoundError,
  SessionRevokedError,
} from '../errors.js';
import type { AuditLogger } from '../audit/audit-logger.js';

export interface CreateSessionResult {
  session: Session;
  rawToken: string;
}

export interface AuthenticatedContext {
  session: Session;
  member: Member;
  device: AuthorizedDevice;
}

export class SessionService {
  constructor(
    private readonly db: DatabaseConnection,
    private readonly auditLogger?: AuditLogger
  ) {}

  /**
   * Generates a 256-bit cryptographic session token and stores its SHA-256 hash in SQLite.
   */
  createSession(memberId: string, deviceId: string, now: Date = new Date()): CreateSessionResult {
    // Check device state
    const deviceRow = this.db
      .prepare(`
        SELECT id, is_approved AS isApproved, expires_at AS expiresAt, revoked_at AS revokedAt
        FROM authorized_devices
        WHERE id = ?
      `)
      .get(deviceId) as {
        id: string;
        isApproved: number;
        expiresAt: string;
        revokedAt: string | null;
      } | undefined;

    if (!deviceRow || deviceRow.isApproved !== 1 || deviceRow.revokedAt) {
      throw new DeviceNotApprovedError(deviceId);
    }

    if (now >= new Date(deviceRow.expiresAt)) {
      throw new DeviceTrustExpiredError();
    }

    // Check member state
    const memberRow = this.db
      .prepare('SELECT id, organization_id AS organizationId, is_active AS isActive FROM members WHERE id = ?')
      .get(memberId) as { id: string; organizationId: string; isActive: number } | undefined;

    if (!memberRow || memberRow.isActive !== 1) {
      throw new MemberInactiveError();
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const domainSession = createDomainSession({
      id: crypto.randomUUID(),
      memberId,
      deviceId,
      tokenHash,
      createdAt: now,
    });

    const stmt = this.db.prepare(`
      INSERT INTO sessions (
        id,
        member_id,
        device_id,
        token_hash,
        last_activity_at,
        idle_expires_at,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      domainSession.id,
      domainSession.memberId,
      domainSession.deviceId,
      domainSession.tokenHash,
      domainSession.lastActivityAt.toISOString(),
      domainSession.idleExpiresAt.toISOString(),
      domainSession.expiresAt.toISOString(),
      domainSession.createdAt.toISOString()
    );

    // Touch device trust expiration (90 days from this activity)
    const newDeviceExpiresAt = new Date(now.getTime() + DEVICE_TRUST_DURATION_MS);
    this.db
      .prepare('UPDATE authorized_devices SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(now.toISOString(), newDeviceExpiresAt.toISOString(), deviceId);

    return {
      session: domainSession,
      rawToken,
    };
  }

  /**
   * Validates raw session token against the stored SHA-256 hash.
   * Enforces 12-hour idle timeout, 30-day absolute timeout, and 90-day device trust.
   * Slides idle timeout if valid.
   */
  validateToken(rawToken: string, now: Date = new Date()): AuthenticatedContext {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new SessionNotFoundError();
    }

    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const row = this.db
      .prepare(`
        SELECT
          s.id AS session_id,
          s.member_id AS session_member_id,
          s.device_id AS session_device_id,
          s.token_hash AS session_token_hash,
          s.last_activity_at AS session_last_activity_at,
          s.idle_expires_at AS session_idle_expires_at,
          s.expires_at AS session_expires_at,
          s.revoked_at AS session_revoked_at,
          s.created_at AS session_created_at,

          m.id AS member_id,
          m.organization_id AS member_org_id,
          m.name AS member_name,
          m.email AS member_email,
          m.role AS member_role,
          m.is_active AS member_is_active,
          m.created_at AS member_created_at,
          m.updated_at AS member_updated_at,

          d.id AS device_id,
          d.device_identifier AS device_identifier,
          d.name AS device_name,
          d.user_agent AS device_user_agent,
          d.ip_address AS device_ip_address,
          d.is_approved AS device_is_approved,
          d.approved_at AS device_approved_at,
          d.approved_by_member_id AS device_approved_by,
          d.last_seen_at AS device_last_seen_at,
          d.expires_at AS device_expires_at,
          d.revoked_at AS device_revoked_at,
          d.created_at AS device_created_at

        FROM sessions s
        JOIN members m ON m.id = s.member_id
        JOIN authorized_devices d ON d.id = s.device_id
        WHERE s.token_hash = ?
      `)
      .get(tokenHash) as {
        session_id: string;
        session_member_id: string;
        session_device_id: string;
        session_token_hash: string;
        session_last_activity_at: string;
        session_idle_expires_at: string;
        session_expires_at: string;
        session_revoked_at: string | null;
        session_created_at: string;

        member_id: string;
        member_org_id: string;
        member_name: string;
        member_email: string;
        member_role: MemberRole;
        member_is_active: number;
        member_created_at: string;
        member_updated_at: string;

        device_id: string;
        device_identifier: string;
        device_name: string;
        device_user_agent: string | null;
        device_ip_address: string | null;
        device_is_approved: number;
        device_approved_at: string | null;
        device_approved_by: string | null;
        device_last_seen_at: string;
        device_expires_at: string;
        device_revoked_at: string | null;
        device_created_at: string;
      } | undefined;

    if (!row) {
      throw new SessionNotFoundError();
    }

    if (row.session_revoked_at) {
      throw new SessionRevokedError();
    }

    const idleExpiresAt = new Date(row.session_idle_expires_at);
    const expiresAt = new Date(row.session_expires_at);

    if (now >= idleExpiresAt || now >= expiresAt) {
      throw new SessionExpiredError();
    }

    if (row.member_is_active !== 1) {
      throw new MemberInactiveError();
    }

    if (row.device_is_approved !== 1 || row.device_revoked_at) {
      throw new DeviceNotApprovedError(row.device_id);
    }

    const deviceExpiresAt = new Date(row.device_expires_at);
    if (now >= deviceExpiresAt) {
      throw new DeviceTrustExpiredError();
    }

    // Touch session: idle expires slides by 12h, capped at absolute expiration (30d)
    const nextIdle = new Date(now.getTime() + SESSION_IDLE_TIMEOUT_MS);
    const effectiveIdle = nextIdle > expiresAt ? expiresAt : nextIdle;

    this.db
      .prepare(`
        UPDATE sessions
        SET last_activity_at = ?, idle_expires_at = ?
        WHERE id = ?
      `)
      .run(now.toISOString(), effectiveIdle.toISOString(), row.session_id);

    // Touch device: slides 90-day trust
    const nextDeviceExpires = new Date(now.getTime() + DEVICE_TRUST_DURATION_MS);
    this.db
      .prepare(`
        UPDATE authorized_devices
        SET last_seen_at = ?, expires_at = ?
        WHERE id = ?
      `)
      .run(now.toISOString(), nextDeviceExpires.toISOString(), row.device_id);

    const session: Session = {
      id: row.session_id,
      memberId: row.session_member_id,
      deviceId: row.session_device_id,
      tokenHash: row.session_token_hash,
      lastActivityAt: now,
      idleExpiresAt: effectiveIdle,
      expiresAt,
      createdAt: new Date(row.session_created_at),
    };

    const member: Member = {
      id: row.member_id,
      organizationId: row.member_org_id,
      name: row.member_name,
      email: row.member_email,
      role: row.member_role,
      isActive: true,
      createdAt: new Date(row.member_created_at),
      updatedAt: new Date(row.member_updated_at),
    };

    const device: AuthorizedDevice = {
      id: row.device_id,
      memberId: row.member_id,
      deviceIdentifier: row.device_identifier,
      name: row.device_name,
      userAgent: row.device_user_agent ?? undefined,
      ipAddress: row.device_ip_address ?? undefined,
      isApproved: true,
      approvedAt: row.device_approved_at ? new Date(row.device_approved_at) : undefined,
      approvedByMemberId: row.device_approved_by ?? undefined,
      lastSeenAt: now,
      expiresAt: nextDeviceExpires,
      createdAt: new Date(row.device_created_at),
    };

    return { session, member, device };
  }

  /**
   * Revokes a session by its raw token (e.g. user logout).
   */
  revokeSessionByToken(rawToken: string, now: Date = new Date()): void {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(now.toISOString(), tokenHash);
  }

  /**
   * Revokes all active sessions belonging to a specific device.
   */
  revokeAllDeviceSessions(deviceId: string, now: Date = new Date()): void {
    this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
      .run(now.toISOString(), deviceId);
  }

  /**
   * Revokes all active sessions for a member.
   */
  revokeAllMemberSessions(memberId: string, now: Date = new Date()): void {
    this.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL')
      .run(now.toISOString(), memberId);
  }
}
