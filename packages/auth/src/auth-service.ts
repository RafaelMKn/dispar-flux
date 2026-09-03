import type { DatabaseConnection } from '@dispar-flux/database';
import type { MemberRole } from '@dispar-flux/domain';
import type {
  ClaimInstallationRequest,
  ClaimInstallationResponse,
  LoginRequest,
  LoginResponse,
  CreateInviteRequest,
  CreateInviteResponse,
  AcceptInviteRequest,
  AcceptInviteResponse,
  DeviceApprovalRequest,
  DeviceApprovalResponse,
} from '@dispar-flux/contracts';
import {
  InvalidCredentialsError,
  MemberInactiveError,
} from './errors.js';
import { PasswordHasher, defaultPasswordHasher } from './password/password-hasher.js';
import { AuditLogger } from './audit/audit-logger.js';
import { ClaimService, type ClaimContext } from './onboarding/claim-service.js';
import { MemberService } from './members/member-service.js';
import { DeviceService } from './devices/device-service.js';
import { SessionService, type AuthenticatedContext } from './sessions/session-service.js';
import { InviteService } from './invites/invite-service.js';
import { RbacGuard } from './rbac/rbac-guard.js';

export interface AuthServiceOptions {
  dataDir: string;
  passwordHasher?: PasswordHasher;
}

export class AuthService {
  public readonly auditLogger: AuditLogger;
  public readonly passwordHasher: PasswordHasher;
  public readonly memberService: MemberService;
  public readonly deviceService: DeviceService;
  public readonly sessionService: SessionService;
  public readonly inviteService: InviteService;
  public readonly claimService: ClaimService;
  public readonly rbacGuard: RbacGuard;

  constructor(
    public readonly db: DatabaseConnection,
    options: AuthServiceOptions
  ) {
    this.passwordHasher = options.passwordHasher ?? defaultPasswordHasher;
    this.auditLogger = new AuditLogger(db);
    this.sessionService = new SessionService(db, this.auditLogger);
    this.memberService = new MemberService(db, this.auditLogger, this.passwordHasher);
    this.deviceService = new DeviceService(db, this.auditLogger);
    this.inviteService = new InviteService(db, this.sessionService, this.auditLogger, this.passwordHasher);
    this.claimService = new ClaimService(
      db,
      options.dataDir,
      this.sessionService,
      this.auditLogger,
      this.passwordHasher
    );
    this.rbacGuard = new RbacGuard(this.sessionService);
  }

  /**
   * Reivindicação inicial da instalação (ADR 0011).
   */
  claim(request: ClaimInstallationRequest, context: ClaimContext = {}): ClaimInstallationResponse {
    return this.claimService.claimInstallation(request, context);
  }

  /**
   * Autenticação de membro com credenciais locais e validação de dispositivo (ADR 0011 & ADR 0047).
   * Se o dispositivo não for autorizado ou tiver confiança expirada, emite solicitação de acesso
   * e NÃO retorna token de sessão ativo.
   */
  login(
    request: LoginRequest,
    context: { userAgent?: string; ipAddress?: string; now?: Date } = {}
  ): LoginResponse {
    const memberRecord = this.memberService.getMemberWithPassword(request.email);
    if (!memberRecord || !memberRecord.passwordHash) {
      throw new InvalidCredentialsError();
    }

    if (!memberRecord.isActive) {
      throw new MemberInactiveError();
    }

    const isValidPassword = this.passwordHasher.verify(request.password, memberRecord.passwordHash);
    if (!isValidPassword) {
      throw new InvalidCredentialsError();
    }

    // Register or get authorized device
    const { device } = this.deviceService.registerOrGetDevice({
      memberId: memberRecord.id,
      deviceFingerprint: request.deviceFingerprint,
      name: request.deviceName,
      userAgent: context.userAgent,
      ipAddress: context.ipAddress,
      now: context.now,
    });

    // If device is not approved (or trust expired), do NOT issue active session
    if (!device.isApproved || device.revokedAt) {
      this.auditLogger.log({
        organizationId: memberRecord.organizationId,
        actorType: 'member',
        actorId: memberRecord.id,
        action: 'auth.login_access_requested',
        targetType: 'device',
        targetId: device.id,
        metadata: {
          deviceIdentifier: device.deviceIdentifier,
        },
      });

      return {
        token: '',
        member: {
          id: memberRecord.id,
          name: memberRecord.name,
          email: memberRecord.email,
          role: memberRecord.role,
        },
        deviceId: device.id,
        requiresDeviceApproval: true,
      };
    }

    // Device is approved & trusted: create session
    const sessionResult = this.sessionService.createSession(memberRecord.id, device.id, context.now);

    this.auditLogger.log({
      organizationId: memberRecord.organizationId,
      actorType: 'member',
      actorId: memberRecord.id,
      action: 'auth.login',
      targetType: 'session',
      targetId: sessionResult.session.id,
      metadata: {
        deviceId: device.id,
      },
    });

    return {
      token: sessionResult.rawToken,
      member: {
        id: memberRecord.id,
        name: memberRecord.name,
        email: memberRecord.email,
        role: memberRecord.role,
      },
      deviceId: device.id,
      requiresDeviceApproval: false,
    };
  }

  /**
   * Encerra sessão ativa (logout).
   */
  logout(rawToken: string): void {
    try {
      const auth = this.sessionService.validateToken(rawToken);
      this.sessionService.revokeSessionByToken(rawToken);
      this.auditLogger.log({
        organizationId: auth.member.organizationId,
        actorType: 'member',
        actorId: auth.member.id,
        action: 'auth.logout',
        targetType: 'session',
        targetId: auth.session.id,
      });
    } catch {
      // Best-effort session revocation
      this.sessionService.revokeSessionByToken(rawToken);
    }
  }

  /**
   * Valida e autentica token de sessão.
   */
  authenticate(rawToken: string, now: Date = new Date()): AuthenticatedContext {
    return this.sessionService.validateToken(rawToken, now);
  }

  /**
   * Criação de convite temporário de uso único (ADR 0018).
   */
  createInvite(
    request: CreateInviteRequest,
    actor: { id: string; role: MemberRole; organizationId: string }
  ): CreateInviteResponse {
    const invite = this.inviteService.createInvite({
      organizationId: actor.organizationId,
      createdByMemberId: actor.id,
      actorRole: actor.role,
      role: request.role,
      expiresInHours: request.expiresInHours,
    });

    return {
      inviteId: invite.id,
      code: invite.code,
      expiresAt: invite.expiresAt.toISOString(),
      role: invite.role,
    };
  }

  /**
   * Aceite de convite e autorização do primeiro dispositivo (ADR 0018).
   */
  acceptInvite(
    request: AcceptInviteRequest,
    context: { userAgent?: string; ipAddress?: string } = {}
  ): AcceptInviteResponse {
    return this.inviteService.acceptInvite(request, context);
  }

  /**
   * Aprovação ou revogação de dispositivo (ADR 0011).
   */
  handleDeviceApproval(
    request: DeviceApprovalRequest,
    actor: { id: string; role: MemberRole; organizationId: string }
  ): DeviceApprovalResponse {
    if (request.approve) {
      const approved = this.deviceService.approveDevice({
        deviceId: request.deviceId,
        approvedByMemberId: actor.id,
        actorRole: actor.role,
        organizationId: actor.organizationId,
      });

      return {
        deviceId: approved.id,
        isApproved: true,
        approvedAt: approved.approvedAt?.toISOString(),
      };
    } else {
      const revoked = this.deviceService.revokeDevice({
        deviceId: request.deviceId,
        actorId: actor.id,
        actorRole: actor.role,
        organizationId: actor.organizationId,
      });

      return {
        deviceId: revoked.id,
        isApproved: false,
      };
    }
  }
}
