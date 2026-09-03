import crypto from 'node:crypto';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  createOrganization,
  DEVICE_TRUST_DURATION_MS,
} from '@dispar-flux/domain';
import type {
  ClaimInstallationRequest,
  ClaimInstallationResponse,
} from '@dispar-flux/contracts';
import {
  AlreadyClaimedError,
  InvalidClaimCodeError,
} from '../errors.js';
import {
  getOrCreateClaimToken,
  verifyClaimToken,
  destroyClaimToken,
} from './claim-token.js';
import { PasswordHasher, defaultPasswordHasher } from '../password/password-hasher.js';
import type { SessionService } from '../sessions/session-service.js';
import type { AuditLogger } from '../audit/audit-logger.js';

export interface ClaimContext {
  userAgent?: string;
  ipAddress?: string;
  deviceFingerprint?: string;
  deviceName?: string;
}

export class ClaimService {
  constructor(
    private readonly db: DatabaseConnection,
    private readonly dataDir: string,
    private readonly sessionService: SessionService,
    private readonly auditLogger?: AuditLogger,
    private readonly passwordHasher: PasswordHasher = defaultPasswordHasher
  ) {}

  /**
   * Checks whether the current installation has already been claimed.
   */
  isClaimed(): boolean {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM organizations')
      .get() as { count: number };
    return Number(row.count) > 0;
  }

  /**
   * Gets or initializes the claim token for first boot.
   * If already claimed, returns null.
   */
  getBootClaimToken(): string | null {
    if (this.isClaimed()) {
      return null;
    }
    return getOrCreateClaimToken(this.dataDir);
  }

  /**
   * Reivindicação inicial da instalação (ADR 0011).
   * Verifies claim code, creates Organization, initial Owner, authorizes first device,
   * creates initial session, destroys claim code, and returns session token.
   */
  claimInstallation(
    request: ClaimInstallationRequest,
    context: ClaimContext = {}
  ): ClaimInstallationResponse {
    if (this.isClaimed()) {
      throw new AlreadyClaimedError();
    }

    const isValidCode = verifyClaimToken(this.dataDir, request.claimCode);
    if (!isValidCode) {
      throw new InvalidClaimCodeError();
    }

    this.passwordHasher.validateStrength(request.password);
    const passwordHash = this.passwordHasher.hash(request.password);

    const org = createOrganization({
      id: crypto.randomUUID(),
      name: request.organizationName,
      operationalTimezone: request.operationalTimezone,
      retentionPolicy: request.retentionPolicyDays,
    });

    const now = new Date();
    const ownerId = crypto.randomUUID();
    const deviceId = crypto.randomUUID();
    const deviceFingerprint = context.deviceFingerprint?.trim() || crypto.randomUUID();
    const deviceName = context.deviceName?.trim() || 'First Administrator Browser';
    const deviceExpiresAt = new Date(now.getTime() + DEVICE_TRUST_DURATION_MS);

    const result = this.db.transaction(() => {
      // 1. Create Organization
      this.db
        .prepare(`
          INSERT INTO organizations (
            id,
            name,
            operational_timezone,
            retention_policy_messages_days,
            retention_policy_media_days,
            retention_policy_logs_days,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          org.id,
          org.name,
          org.operationalTimezone,
          org.retentionPolicy.messagesDays,
          org.retentionPolicy.mediaDays,
          org.retentionPolicy.logsDays,
          org.createdAt.toISOString(),
          org.updatedAt.toISOString()
        );

      // 2. Create initial Owner
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
          ) VALUES (?, ?, ?, ?, 'owner', ?, 1, ?, ?)
        `)
        .run(
          ownerId,
          org.id,
          request.ownerName.trim(),
          request.ownerEmail.trim().toLowerCase(),
          passwordHash,
          now.toISOString(),
          now.toISOString()
        );

      // 3. Authorize the first device immediately (ADR 0011)
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
          ownerId,
          deviceFingerprint,
          deviceName,
          context.userAgent ?? null,
          context.ipAddress ?? null,
          now.toISOString(),
          ownerId,
          now.toISOString(),
          deviceExpiresAt.toISOString(),
          now.toISOString()
        );

      // 4. Create active session on this authorized device
      const sessionResult = this.sessionService.createSession(ownerId, deviceId, now);

      // 5. Essential Audit log
      this.auditLogger?.log({
        organizationId: org.id,
        actorType: 'member',
        actorId: ownerId,
        action: 'auth.claim',
        targetType: 'organization',
        targetId: org.id,
        metadata: {
          ownerEmail: request.ownerEmail.trim().toLowerCase(),
          timezone: org.operationalTimezone,
        },
      });

      return {
        sessionResult,
      };
    });

    // 6. Destroy claim code immediately after successful claim
    destroyClaimToken(this.dataDir);

    return {
      organizationId: org.id,
      ownerId,
      token: result.sessionResult.rawToken,
      recoveryKeyGuidance:
        'Instalação reivindicada com sucesso. Guarde a Chave de Recuperação fora da VPS para possibilitar a restauração de backups criptografados (ADR 0020).',
      message: 'Organização e Proprietário inicial criados com sucesso.',
    };
  }
}
