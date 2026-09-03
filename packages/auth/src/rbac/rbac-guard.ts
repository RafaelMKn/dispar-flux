import type { MemberRole } from '@dispar-flux/domain';
import { Permission, hasPermission } from './permissions.js';
import { ForbiddenError, UnauthorizedError } from '../errors.js';
import type { SessionService, AuthenticatedContext } from '../sessions/session-service.js';

export interface ActorContext {
  id: string;
  role: MemberRole;
  organizationId: string;
}

/**
 * Asserts that a role possesses a required capability, throwing ForbiddenError if unauthorized.
 */
export function assertPermission(role: MemberRole, permission: Permission): void {
  if (!hasPermission(role, permission)) {
    throw new ForbiddenError(
      `Access denied: role "${role}" lacks permission "${permission}".`
    );
  }
}

/**
 * Evaluates whether an actor can manage a target device:
 * - Owners can manage any device in the organization (ADR 0029 & Master Plan Section 9).
 * - Operators can ONLY manage their own device (DEVICES_MANAGE_OWN).
 */
export function canManageDevice(
  actor: { id: string; role: MemberRole },
  targetDeviceMemberId: string
): boolean {
  if (actor.role === 'owner') {
    return true;
  }
  if (actor.role === 'operator') {
    return actor.id === targetDeviceMemberId;
  }
  return false;
}

/**
 * Asserts that an actor can manage the target device, throwing ForbiddenError if denied.
 */
export function assertCanManageDevice(
  actor: { id: string; role: MemberRole },
  targetDeviceMemberId: string
): void {
  if (!canManageDevice(actor, targetDeviceMemberId)) {
    throw new ForbiddenError('Operators are only authorized to manage their own devices.');
  }
}

/**
 * Lightweight standard HTTP request/response handler interface for middleware integration.
 */
export interface AuthHttpRequest {
  headers: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
  auth?: AuthenticatedContext;
}

export interface AuthHttpResponse {
  statusCode?: number;
  setHeader?(name: string, value: string): void;
  end?(body?: string): void;
}

export type AuthNextFunction = (err?: unknown) => void;

/**
 * Extracts bearer token from HTTP request Authorization header or dispar_session cookie.
 */
export function extractTokenFromRequest(req: AuthHttpRequest): string | null {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader && typeof authHeader === 'string') {
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  if (req.cookies?.['dispar_session']) {
    return req.cookies['dispar_session'];
  }

  return null;
}

/**
 * Creates authentication and authorization middleware helpers.
 */
export class RbacGuard {
  constructor(private readonly sessionService: SessionService) {}

  /**
   * Middleware that verifies authentication token and sets req.auth.
   */
  authenticate() {
    return (req: AuthHttpRequest, res: AuthHttpResponse, next: AuthNextFunction) => {
      const token = extractTokenFromRequest(req);
      if (!token) {
        return next(new UnauthorizedError('Missing authentication token.'));
      }

      try {
        const auth = this.sessionService.validateToken(token);
        req.auth = auth;
        return next();
      } catch (err) {
        return next(err);
      }
    };
  }

  /**
   * Middleware that checks for a required RBAC permission.
   */
  requirePermission(permission: Permission) {
    return (req: AuthHttpRequest, res: AuthHttpResponse, next: AuthNextFunction) => {
      if (!req.auth) {
        return next(new UnauthorizedError('Authentication required before permission check.'));
      }

      try {
        assertPermission(req.auth.member.role, permission);
        return next();
      } catch (err) {
        return next(err);
      }
    };
  }

  /**
   * Middleware that enforces device management ownership for operators.
   */
  requireDeviceAccess(getTargetMemberId: (req: AuthHttpRequest) => string) {
    return (req: AuthHttpRequest, res: AuthHttpResponse, next: AuthNextFunction) => {
      if (!req.auth) {
        return next(new UnauthorizedError('Authentication required.'));
      }

      const targetMemberId = getTargetMemberId(req);
      try {
        assertCanManageDevice(
          { id: req.auth.member.id, role: req.auth.member.role },
          targetMemberId
        );
        return next();
      } catch (err) {
        return next(err);
      }
    };
  }
}
