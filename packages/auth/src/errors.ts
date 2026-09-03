/**
 * Auth module specific domain and operational errors.
 */

export class AuthError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code = 'AUTH_ERROR', statusCode = 400, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor(message = 'Credenciais inválidas.') {
    super(message, 'INVALID_CREDENTIALS', 401);
  }
}

export class DeviceNotApprovedError extends AuthError {
  public readonly deviceId?: string;
  constructor(deviceId?: string, message = 'Dispositivo aguarda aprovação de um Proprietário.') {
    super(message, 'DEVICE_NOT_APPROVED', 403);
    this.deviceId = deviceId;
  }
}

export class DeviceTrustExpiredError extends AuthError {
  constructor(message = 'A confiança deste dispositivo expirou por inatividade (90 dias).') {
    super(message, 'DEVICE_TRUST_EXPIRED', 401);
  }
}

export class DeviceRevokedError extends AuthError {
  constructor(message = 'Dispositivo revogado.') {
    super(message, 'DEVICE_REVOKED', 401);
  }
}

export class SessionExpiredError extends AuthError {
  constructor(message = 'Sessão expirada.') {
    super(message, 'SESSION_EXPIRED', 401);
  }
}

export class SessionRevokedError extends AuthError {
  constructor(message = 'Sessão revogada.') {
    super(message, 'SESSION_REVOKED', 401);
  }
}

export class SessionNotFoundError extends AuthError {
  constructor(message = 'Sessão não encontrada.') {
    super(message, 'SESSION_NOT_FOUND', 401);
  }
}

export class InviteInvalidError extends AuthError {
  constructor(message = 'Convite de acesso inválido, expirado ou já utilizado.') {
    super(message, 'INVITE_INVALID', 400);
  }
}

export class AlreadyClaimedError extends AuthError {
  constructor(message = 'Esta instalação já foi reivindicada por um Proprietário.') {
    super(message, 'ALREADY_CLAIMED', 409);
  }
}

export class InvalidClaimCodeError extends AuthError {
  constructor(message = 'Código de reivindicação inválido.') {
    super(message, 'INVALID_CLAIM_CODE', 400);
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message = 'Não autenticado.') {
    super(message, 'UNAUTHORIZED', 401);
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = 'Permissão insuficiente para executar esta ação.') {
    super(message, 'FORBIDDEN', 403);
  }
}

export class MemberNotFoundError extends AuthError {
  constructor(message = 'Membro não encontrado.') {
    super(message, 'MEMBER_NOT_FOUND', 404);
  }
}

export class MemberInactiveError extends AuthError {
  constructor(message = 'Membro desativado.') {
    super(message, 'MEMBER_INACTIVE', 403);
  }
}

export class LastOwnerProtectionError extends AuthError {
  constructor(message = 'A Organização deve conservar pelo menos um Proprietário ativo (Proprietário).') {
    super(message, 'LAST_OWNER_PROTECTION', 400);
  }
}

export class WeakPasswordError extends AuthError {
  constructor(message = 'A senha deve ter no mínimo 8 caracteres.') {
    super(message, 'WEAK_PASSWORD', 400);
  }
}
