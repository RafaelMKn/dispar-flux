import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  type AccessInvite,
  type MemberRole,
  createAccessInvite,
  isInviteValid,
  DEFAULT_INVITE_VALIDITY_HOURS,
  DEVICE_TRUST_DURATION_MS,
} from '@dispar-flux/domain';
import type { AcceptInviteRequest, AcceptInviteResponse } from '@dispar-flux/contracts';
import {
  AuthError,
  ForbiddenError,
  InviteInvalidError,
} from '../errors.js';
import { PasswordHasher, defaultPasswordHasher } from '../password/password-hasher.js';
import type { SessionService } from '../sessions/session-service.js';
import type { AuditLogger } from '../audit/audit-logger.js';

export interface CreateInviteInput {
  organizationId: string;
  createdByMemberId: string;
  actorRole: MemberRole;
  role: MemberRole;
  expiresInHours?: number;
}

export class InviteService {
  constructor(
    private readonly db: DatabaseConnection,
    private readonly sessionService: SessionService,
    private readonly auditLogger?: AuditLogger,
    private readonly passwordHasher: PasswordHasher = defaultPasswordHasher
  ) {}

  /**
   * Generates a time-limited single-use access invite (default 48h).
   * Restricted to Owners (ADR 0018).
   */
  createInvite(input: CreateInviteInput): AccessInvite {
    if (input.actorRole !== 'owner') {
      throw new ForbiddenError('Only Owners (Proprietários) can generate access invites.');
    }

    const hours = input.expiresInHours ?? DEFAULT_INVITE_VALIDITY_HOURS;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + hours * 60 * 60 * 1000);

    const randomSuffix = crypto.randomBytes(12).toString('hex');
    const code = `inv_${randomSuffix}`;

    const invite = createAccessInvite({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      createdByMemberId: input.createdByMemberId,
      code,
      role: input.role,
      expiresAt,
      createdAt: now,
    });

    const stmt = this.db.prepare(`
      INSERT INTO access_invites (
        id,
        organization_id,
        created_by_member_id,
        code,
        role,
        expires_at,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      invite.id,
      invite.organizationId,
      invite.createdByMemberId,
      invite.code,
      invite.role,
      invite.expiresAt.toISOString(),
      invite.createdAt.toISOString()
    );

    this.auditLogger?.log({
      organizationId: invite.organizationId,
      actorType: 'member',
      actorId: input.createdByMemberId,
      action: 'invite.create',
      targetType: 'invite',
      targetId: invite.id,
      metadata: {
        role: invite.role,
        expiresAt: invite.expiresAt.toISOString(),
      },
    });

    return invite;
  }

  /**
   * Retrieves an invite by its unique code.
   */
  getInviteByCode(code: string): AccessInvite | null {
    const row = this.db
      .prepare(`
        SELECT
          id,
          organization_id AS organizationId,
          created_by_member_id AS createdByMemberId,
          code,
          role,
          expires_at AS expiresAt,
          used_at AS usedAt,
          used_by_member_id AS usedByMemberId,
          created_at AS createdAt
        FROM access_invites
        WHERE code = ?
      `)
      .get(code.trim()) as {
        id: string;
        organizationId: string;
        createdByMemberId: string;
        code: string;
        role: MemberRole;
        expiresAt: string;
        usedAt: string | null;
        usedByMemberId: string | null;
        createdAt: string;
      } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organizationId,
      createdByMemberId: row.createdByMemberId,
      code: row.code,
      role: row.role,
      expiresAt: new Date(row.expiresAt),
      usedAt: row.usedAt ? new Date(row.usedAt) : undefined,
      usedByMemberId: row.usedByMemberId ?? undefined,
      createdAt: new Date(row.createdAt),
    };
  }

  /**
   * Redeems an access invite: creates Member, authorizes initial device, and issues session (ADR 0018).
   */
  acceptInvite(
    request: AcceptInviteRequest,
    context: { userAgent?: string; ipAddress?: string } = {}
  ): AcceptInviteResponse {
    const invite = this.getInviteByCode(request.code);
    if (!invite || !isInviteValid(invite)) {
      throw new InviteInvalidError();
    }

    const email = request.email.trim().toLowerCase();
    const existing = this.db
      .prepare('SELECT id FROM members WHERE email = ?')
      .get(email) as { id: string } | undefined;

    if (existing) {
      throw new AuthError(`Email "${request.email}" is already registered.`, 'EMAIL_ALREADY_EXISTS', 409);
    }

    this.passwordHasher.validateStrength(request.password);
    const passwordHash = this.passwordHasher.hash(request.password);

    const now = new Date();
    const memberId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const deviceIdentifier = request.deviceFingerprint.trim();
    const deviceName = request.deviceName?.trim() || 'First Browser';
    const deviceExpiresAt = new Date(now.getTime() + DEVICE_TRUST_DURATION_MS);

    return this.db.transaction(() => {
      // 1. Create Member
      this.db
        .prepare(`
          INSERT INTO members (
            id,
            organization_id,
            name,
            email,
            role,
            password_hash,
            is_active,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `)
        .run(
          memberId,
          invite.organizationId,
          request.name.trim(),
          email,
          invite.role,
          passwordHash,
          now.toISOString(),
          now.toISOString()
        );

      // 2. Mark invite as used
      this.db
        .prepare(`
          UPDATE access_invites
          SET used_at = ?, used_by_member_id = ?
          WHERE id = ?
        `)
        .run(now.toISOString(), memberId, invite.id);

      // 3. Authorize the first device immediately (ADR 0018)
      this.db
        .prepare(`
          INSERT INTO authorized_devices (
            id,
            member_id,
            device_identifier,
            name,
            user_agent,
            ip_address,
            is_approved,
            approved_at,
            approved_by_member_id,
            last_seen_at,
            expires_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
        `)
        .run(
          deviceId,
          memberId,
          deviceIdentifier,
          deviceName,
          context.userAgent ?? null,
          context.ipAddress ?? null,
          now.toISOString(),
          memberId,
          now.toISOString(),
          deviceExpiresAt.toISOString(),
          now.toISOString()
        );

      // 4. Create active session on this authorized device
      const sessionResult = this.sessionService.createSession(memberId, deviceId, now);

      // 5. Audit record
      this.auditLogger?.log({
        organizationId: invite.organizationId,
        actorType: 'member',
        actorId: memberId,
        action: 'invite.accept',
        targetType: 'member',
        targetId: memberId,
        metadata: {
          inviteId: invite.id,
          role: invite.role,
        },
      });

      return {
        memberId,
        token: sessionResult.rawToken,
        deviceId,
      };
    });
  }
}
