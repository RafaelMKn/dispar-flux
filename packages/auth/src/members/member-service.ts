import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  type Member,
  type MemberRole,
  createMember as createDomainMember,
} from '@dispar-flux/domain';
import {
  AuthError,
  LastOwnerProtectionError,
  MemberNotFoundError,
} from '../errors.js';
import { PasswordHasher, defaultPasswordHasher } from '../password/password-hasher.js';
import type { AuditLogger } from '../audit/audit-logger.js';

export interface CreateMemberInput {
  organizationId: string;
  name: string;
  email: string;
  password?: string;
  role: MemberRole;
  isActive?: boolean;
  actorId?: string;
}

export interface UpdateMemberInput {
  name?: string;
  role?: MemberRole;
  isActive?: boolean;
  password?: string;
  actorId?: string;
}

export interface MemberRecord extends Member {
  passwordHash: string | null;
}

export class MemberService {
  constructor(
    private readonly db: DatabaseConnection,
    private readonly auditLogger?: AuditLogger,
    private readonly passwordHasher: PasswordHasher = defaultPasswordHasher
  ) {}

  /**
   * Creates a new member with role Owner or Operator.
   */
  createMember(input: CreateMemberInput): Member {
    const existing = this.db
      .prepare('SELECT id FROM members WHERE email = ?')
      .get(input.email.trim().toLowerCase()) as { id: string } | undefined;

    if (existing) {
      throw new AuthError(`A member with email "${input.email}" already exists.`, 'EMAIL_ALREADY_EXISTS', 409);
    }

    const domainMember = createDomainMember({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      name: input.name,
      email: input.email,
      role: input.role,
      isActive: input.isActive ?? true,
    });

    const passwordHash = input.password ? this.passwordHasher.hash(input.password) : null;

    const stmt = this.db.prepare(`
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      domainMember.id,
      domainMember.organizationId,
      domainMember.name,
      domainMember.email,
      domainMember.role,
      passwordHash,
      domainMember.isActive ? 1 : 0,
      domainMember.createdAt.toISOString(),
      domainMember.updatedAt.toISOString()
    );

    this.auditLogger?.log({
      organizationId: domainMember.organizationId,
      actorType: 'member',
      actorId: input.actorId || domainMember.id,
      action: 'member.create',
      targetType: 'member',
      targetId: domainMember.id,
      metadata: {
        role: domainMember.role,
        email: domainMember.email,
      },
    });

    return domainMember;
  }

  /**
   * Retrieves member by ID.
   */
  getMemberById(id: string): Member | null {
    const row = this.db
      .prepare(`
        SELECT
          id,
          organization_id AS organizationId,
          name,
          email,
          role,
          is_active AS isActive,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM members
        WHERE id = ?
      `)
      .get(id) as {
        id: string;
        organizationId: string;
        name: string;
        email: string;
        role: MemberRole;
        isActive: number;
        createdAt: string;
        updatedAt: string;
      } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      email: row.email,
      role: row.role,
      isActive: row.isActive === 1,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  /**
   * Retrieves member by email with password hash for authentication.
   */
  getMemberWithPassword(email: string): MemberRecord | null {
    const row = this.db
      .prepare(`
        SELECT
          id,
          organization_id AS organizationId,
          name,
          email,
          role,
          password_hash AS passwordHash,
          is_active AS isActive,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM members
        WHERE email = ?
      `)
      .get(email.trim().toLowerCase()) as {
        id: string;
        organizationId: string;
        name: string;
        email: string;
        role: MemberRole;
        passwordHash: string | null;
        isActive: number;
        createdAt: string;
        updatedAt: string;
      } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      email: row.email,
      role: row.role,
      passwordHash: row.passwordHash,
      isActive: row.isActive === 1,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  /**
   * Lists all members in an organization.
   */
  listMembers(organizationId: string): Member[] {
    const rows = this.db
      .prepare(`
        SELECT
          id,
          organization_id AS organizationId,
          name,
          email,
          role,
          is_active AS isActive,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM members
        WHERE organization_id = ?
        ORDER BY created_at ASC
      `)
      .all(organizationId) as unknown as Array<{
        id: string;
        organizationId: string;
        name: string;
        email: string;
        role: MemberRole;
        isActive: number;
        createdAt: string;
        updatedAt: string;
      }>;

    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      email: row.email,
      role: row.role,
      isActive: row.isActive === 1,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  /**
   * Updates a member while enforcing the invariant that at least one active Owner must be preserved.
   * (ADR 0029: uma organização nunca poderá remover ou rebaixar o último proprietário).
   */
  updateMember(memberId: string, updates: UpdateMemberInput): Member {
    const current = this.getMemberById(memberId);
    if (!current) {
      throw new MemberNotFoundError(`Member with id "${memberId}" not found`);
    }

    const nextRole = updates.role ?? current.role;
    const nextActive = updates.isActive ?? current.isActive;

    // Invariant check: if current member is active Owner and is being deactivated or demoted to operator
    if (current.role === 'owner' && current.isActive) {
      const isDemoting = nextRole !== 'owner';
      const isDeactivating = !nextActive;

      if (isDemoting || isDeactivating) {
        const remainingOwnersRow = this.db
          .prepare(`
            SELECT COUNT(*) AS count
            FROM members
            WHERE organization_id = ? AND role = 'owner' AND is_active = 1 AND id != ?
          `)
          .get(current.organizationId, current.id) as { count: number };

        if (Number(remainingOwnersRow.count) < 1) {
          throw new LastOwnerProtectionError(
            'Cannot demote or deactivate the last remaining active Owner (Proprietário) of the organization'
          );
        }
      }
    }

    const now = new Date();
    const newName = updates.name !== undefined ? updates.name.trim() : current.name;
    const newPasswordHash = updates.password ? this.passwordHasher.hash(updates.password) : undefined;

    return this.db.transaction(() => {
      if (newPasswordHash !== undefined) {
        this.db
          .prepare(`
            UPDATE members
            SET name = ?, role = ?, is_active = ?, password_hash = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(newName, nextRole, nextActive ? 1 : 0, newPasswordHash, now.toISOString(), memberId);
      } else {
        this.db
          .prepare(`
            UPDATE members
            SET name = ?, role = ?, is_active = ?, updated_at = ?
            WHERE id = ?
          `)
          .run(newName, nextRole, nextActive ? 1 : 0, now.toISOString(), memberId);
      }

      // If deactivated, revoke all active sessions for this member immediately
      if (!nextActive && current.isActive) {
        this.db
          .prepare('UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL')
          .run(now.toISOString(), memberId);
      }

      this.auditLogger?.log({
        organizationId: current.organizationId,
        actorType: 'member',
        actorId: updates.actorId || memberId,
        action: 'member.update',
        targetType: 'member',
        targetId: memberId,
        metadata: {
          previousRole: current.role,
          newRole: nextRole,
          previousActive: current.isActive,
          newActive: nextActive,
        },
      });

      return {
        ...current,
        name: newName,
        role: nextRole,
        isActive: nextActive,
        updatedAt: now,
      };
    });
  }

  /**
   * Resets password directly for emergency recovery or self-service password reset.
   */
  setPassword(memberId: string, newPlainPassword: string, actorId = 'system'): void {
    const member = this.getMemberById(memberId);
    if (!member) {
      throw new MemberNotFoundError(`Member with id "${memberId}" not found`);
    }

    const hash = this.passwordHasher.hash(newPlainPassword);
    const now = new Date();

    this.db.transaction(() => {
      this.db
        .prepare('UPDATE members SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(hash, now.toISOString(), memberId);

      // Revoke all existing sessions so member must re-authenticate with new password
      this.db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL')
        .run(now.toISOString(), memberId);

      this.auditLogger?.log({
        organizationId: member.organizationId,
        actorType: actorId === 'system' ? 'system' : 'member',
        actorId,
        action: 'member.password_reset',
        targetType: 'member',
        targetId: memberId,
      });
    });
  }
}
