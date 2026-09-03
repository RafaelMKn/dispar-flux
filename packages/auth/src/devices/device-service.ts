import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  type AuthorizedDevice,
  type MemberRole,
  createAuthorizedDevice,
  DEVICE_TRUST_DURATION_MS,
} from '@dispar-flux/domain';
import {
  AuthError,
  ForbiddenError,
} from '../errors.js';
import type { AuditLogger } from '../audit/audit-logger.js';

export interface RegisterDeviceInput {
  memberId: string;
  deviceFingerprint: string;
  name?: string;
  userAgent?: string;
  ipAddress?: string;
  now?: Date;
}

export interface ApproveDeviceInput {
  deviceId: string;
  approvedByMemberId: string;
  actorRole: MemberRole;
  organizationId: string;
}

export interface RevokeDeviceInput {
  deviceId: string;
  actorId: string;
  actorRole: MemberRole;
  organizationId: string;
}

export class DeviceService {
  constructor(
    private readonly db: DatabaseConnection,
    private readonly auditLogger?: AuditLogger
  ) {}

  /**
   * Registers a device or retrieves existing device.
   * If the device is unapproved, returns it without granting trust.
   * If trust expired (> 90 days of inactivity), revokes active approval status.
   */
  registerOrGetDevice(input: RegisterDeviceInput): { device: AuthorizedDevice; isNew: boolean } {
    const now = input.now ?? new Date();
    const deviceIdentifier = input.deviceFingerprint.trim();
    const defaultName = input.name?.trim() || (input.userAgent ? input.userAgent.slice(0, 50) : 'Browser Client');

    const row = this.db
      .prepare(`
        SELECT
          id,
          member_id AS memberId,
          device_identifier AS deviceIdentifier,
          name,
          user_agent AS userAgent,
          ip_address AS ipAddress,
          is_approved AS isApproved,
          approved_at AS approvedAt,
          approved_by_member_id AS approvedByMemberId,
          last_seen_at AS lastSeenAt,
          expires_at AS expiresAt,
          revoked_at AS revokedAt,
          created_at AS createdAt
        FROM authorized_devices
        WHERE member_id = ? AND device_identifier = ?
      `)
      .get(input.memberId, deviceIdentifier) as {
        id: string;
        memberId: string;
        deviceIdentifier: string;
        name: string;
        userAgent: string | null;
        ipAddress: string | null;
        isApproved: number;
        approvedAt: string | null;
        approvedByMemberId: string | null;
        lastSeenAt: string;
        expiresAt: string;
        revokedAt: string | null;
        createdAt: string;
      } | undefined;

    if (row) {
      const device: AuthorizedDevice = {
        id: row.id,
        memberId: row.memberId,
        deviceIdentifier: row.deviceIdentifier,
        name: row.name,
        userAgent: row.userAgent ?? undefined,
        ipAddress: row.ipAddress ?? undefined,
        isApproved: row.isApproved === 1,
        approvedAt: row.approvedAt ? new Date(row.approvedAt) : undefined,
        approvedByMemberId: row.approvedByMemberId ?? undefined,
        lastSeenAt: new Date(row.lastSeenAt),
        expiresAt: new Date(row.expiresAt),
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : undefined,
        createdAt: new Date(row.createdAt),
      };

      // Check 90 days inactivity trust expiration (ADR 0047)
      if (device.isApproved && !device.revokedAt) {
        if (now >= device.expiresAt) {
          // Trust has expired due to 90 days inactivity!
          this.db
            .prepare(`
              UPDATE authorized_devices
              SET is_approved = 0
              WHERE id = ?
            `)
            .run(device.id);

          device.isApproved = false;
        } else {
          // Touch device to slide 90-day inactivity trust window
          const newExpiresAt = new Date(now.getTime() + DEVICE_TRUST_DURATION_MS);
          this.db
            .prepare(`
              UPDATE authorized_devices
              SET last_seen_at = ?, expires_at = ?, user_agent = COALESCE(?, user_agent), ip_address = COALESCE(?, ip_address)
              WHERE id = ?
            `)
            .run(
              now.toISOString(),
              newExpiresAt.toISOString(),
              input.userAgent ?? null,
              input.ipAddress ?? null,
              device.id
            );

          device.lastSeenAt = now;
          device.expiresAt = newExpiresAt;
        }
      }

      return { device, isNew: false };
    }

    // New device attempt: register with is_approved = 0 (Access Request)
    const newDevice = createAuthorizedDevice({
      id: crypto.randomUUID(),
      memberId: input.memberId,
      deviceIdentifier,
      name: defaultName,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      isApproved: false,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + DEVICE_TRUST_DURATION_MS),
      createdAt: now,
    });

    const stmt = this.db.prepare(`
      INSERT INTO authorized_devices (
        id,
        member_id,
        device_identifier,
        name,
        user_agent,
        ip_address,
        is_approved,
        last_seen_at,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `);

    stmt.run(
      newDevice.id,
      newDevice.memberId,
      newDevice.deviceIdentifier,
      newDevice.name,
      newDevice.userAgent ?? null,
      newDevice.ipAddress ?? null,
      newDevice.lastSeenAt.toISOString(),
      newDevice.expiresAt.toISOString(),
      newDevice.createdAt.toISOString()
    );

    return { device: newDevice, isNew: true };
  }

  /**
   * Approves a pending device. Only Owners can approve devices (ADR 0011 & ADR 0029).
   */
  approveDevice(input: ApproveDeviceInput): AuthorizedDevice {
    if (input.actorRole !== 'owner') {
      throw new ForbiddenError('Only Owners (Proprietários) can approve authorized devices.');
    }

    const device = this.getDeviceById(input.deviceId);
    if (!device) {
      throw new AuthError(`Device with id "${input.deviceId}" not found.`, 'DEVICE_NOT_FOUND', 404);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + DEVICE_TRUST_DURATION_MS);

    this.db
      .prepare(`
        UPDATE authorized_devices
        SET is_approved = 1, approved_at = ?, approved_by_member_id = ?, expires_at = ?, revoked_at = NULL
        WHERE id = ?
      `)
      .run(now.toISOString(), input.approvedByMemberId, expiresAt.toISOString(), device.id);

    this.auditLogger?.log({
      organizationId: input.organizationId,
      actorType: 'member',
      actorId: input.approvedByMemberId,
      action: 'device.approve',
      targetType: 'device',
      targetId: device.id,
      metadata: {
        deviceMemberId: device.memberId,
        deviceIdentifier: device.deviceIdentifier,
      },
    });

    return {
      ...device,
      isApproved: true,
      approvedAt: now,
      approvedByMemberId: input.approvedByMemberId,
      expiresAt,
      revokedAt: undefined,
    };
  }

  /**
   * Revokes an authorized device and all associated active sessions (ADR 0047).
   * Owners can revoke any device; Operators can only revoke their own device.
   */
  revokeDevice(input: RevokeDeviceInput): AuthorizedDevice {
    const device = this.getDeviceById(input.deviceId);
    if (!device) {
      throw new AuthError(`Device with id "${input.deviceId}" not found.`, 'DEVICE_NOT_FOUND', 404);
    }

    if (input.actorRole !== 'owner' && device.memberId !== input.actorId) {
      throw new ForbiddenError('Operators may only revoke their own devices.');
    }

    const now = new Date();

    return this.db.transaction(() => {
      this.db
        .prepare(`
          UPDATE authorized_devices
          SET is_approved = 0, revoked_at = ?
          WHERE id = ?
        `)
        .run(now.toISOString(), device.id);

      // Revoke all sessions belonging to this device (ADR 0047)
      this.db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL')
        .run(now.toISOString(), device.id);

      this.auditLogger?.log({
        organizationId: input.organizationId,
        actorType: 'member',
        actorId: input.actorId,
        action: 'device.revoke',
        targetType: 'device',
        targetId: device.id,
        metadata: {
          deviceMemberId: device.memberId,
        },
      });

      return {
        ...device,
        isApproved: false,
        revokedAt: now,
      };
    });
  }

  /**
   * Retrieves a device by its ID.
   */
  getDeviceById(deviceId: string): AuthorizedDevice | null {
    const row = this.db
      .prepare(`
        SELECT
          id,
          member_id AS memberId,
          device_identifier AS deviceIdentifier,
          name,
          user_agent AS userAgent,
          ip_address AS ipAddress,
          is_approved AS isApproved,
          approved_at AS approvedAt,
          approved_by_member_id AS approvedByMemberId,
          last_seen_at AS lastSeenAt,
          expires_at AS expiresAt,
          revoked_at AS revokedAt,
          created_at AS createdAt
        FROM authorized_devices
        WHERE id = ?
      `)
      .get(deviceId) as {
        id: string;
        memberId: string;
        deviceIdentifier: string;
        name: string;
        userAgent: string | null;
        ipAddress: string | null;
        isApproved: number;
        approvedAt: string | null;
        approvedByMemberId: string | null;
        lastSeenAt: string;
        expiresAt: string;
        revokedAt: string | null;
        createdAt: string;
      } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      memberId: row.memberId,
      deviceIdentifier: row.deviceIdentifier,
      name: row.name,
      userAgent: row.userAgent ?? undefined,
      ipAddress: row.ipAddress ?? undefined,
      isApproved: row.isApproved === 1,
      approvedAt: row.approvedAt ? new Date(row.approvedAt) : undefined,
      approvedByMemberId: row.approvedByMemberId ?? undefined,
      lastSeenAt: new Date(row.lastSeenAt),
      expiresAt: new Date(row.expiresAt),
      revokedAt: row.revokedAt ? new Date(row.revokedAt) : undefined,
      createdAt: new Date(row.createdAt),
    };
  }

  /**
   * Lists devices for an organization or member.
   */
  listDevices(organizationId: string, filter?: { memberId?: string }): AuthorizedDevice[] {
    let sql = `
      SELECT
        d.id,
        d.member_id AS memberId,
        d.device_identifier AS deviceIdentifier,
        d.name,
        d.user_agent AS userAgent,
        d.ip_address AS ipAddress,
        d.is_approved AS isApproved,
        d.approved_at AS approvedAt,
        d.approved_by_member_id AS approvedByMemberId,
        d.last_seen_at AS lastSeenAt,
        d.expires_at AS expiresAt,
        d.revoked_at AS revokedAt,
        d.created_at AS createdAt
      FROM authorized_devices d
      JOIN members m ON m.id = d.member_id
      WHERE m.organization_id = ?
    `;

    const bindings: string[] = [organizationId];

    if (filter?.memberId) {
      sql += ' AND d.member_id = ?';
      bindings.push(filter.memberId);
    }

    sql += ' ORDER BY d.last_seen_at DESC';

    const rows = this.db.prepare(sql).all(...bindings) as unknown as Array<{
      id: string;
      memberId: string;
      deviceIdentifier: string;
      name: string;
      userAgent: string | null;
      ipAddress: string | null;
      isApproved: number;
      approvedAt: string | null;
      approvedByMemberId: string | null;
      lastSeenAt: string;
      expiresAt: string;
      revokedAt: string | null;
      createdAt: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      memberId: row.memberId,
      deviceIdentifier: row.deviceIdentifier,
      name: row.name,
      userAgent: row.userAgent ?? undefined,
      ipAddress: row.ipAddress ?? undefined,
      isApproved: row.isApproved === 1,
      approvedAt: row.approvedAt ? new Date(row.approvedAt) : undefined,
      approvedByMemberId: row.approvedByMemberId ?? undefined,
      lastSeenAt: new Date(row.lastSeenAt),
      expiresAt: new Date(row.expiresAt),
      revokedAt: row.revokedAt ? new Date(row.revokedAt) : undefined,
      createdAt: new Date(row.createdAt),
    }));
  }
}
