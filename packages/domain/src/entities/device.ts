import { InvariantViolationError } from '../errors/domain-errors.js';

export const DEVICE_TRUST_DURATION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days of inactivity

export interface AuthorizedDevice {
  id: string;
  memberId: string;
  deviceIdentifier: string; // Hardware/client fingerprint or persistent identifier
  name: string;
  userAgent?: string;
  ipAddress?: string;
  isApproved: boolean;
  approvedAt?: Date;
  approvedByMemberId?: string;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
  createdAt: Date;
}

export interface CreateAuthorizedDeviceParams {
  id: string;
  memberId: string;
  deviceIdentifier: string;
  name: string;
  userAgent?: string;
  ipAddress?: string;
  isApproved?: boolean;
  approvedByMemberId?: string;
  lastSeenAt?: Date;
  expiresAt?: Date;
  createdAt?: Date;
}

export function createAuthorizedDevice(params: CreateAuthorizedDeviceParams): AuthorizedDevice {
  const deviceIdentifier = params.deviceIdentifier.trim();
  const name = params.name.trim();

  if (!deviceIdentifier) {
    throw new InvariantViolationError('Device identifier cannot be empty');
  }
  if (!name) {
    throw new InvariantViolationError('Device name cannot be empty');
  }

  const now = params.createdAt ?? new Date();
  const lastSeen = params.lastSeenAt ?? now;
  const expiresAt = params.expiresAt ?? new Date(lastSeen.getTime() + DEVICE_TRUST_DURATION_MS);
  const isApproved = params.isApproved ?? false;

  return {
    id: params.id,
    memberId: params.memberId,
    deviceIdentifier,
    name,
    userAgent: params.userAgent,
    ipAddress: params.ipAddress,
    isApproved,
    approvedAt: isApproved ? (params.createdAt ?? now) : undefined,
    approvedByMemberId: params.approvedByMemberId,
    lastSeenAt: lastSeen,
    expiresAt,
    createdAt: now,
  };
}

export function isDeviceTrustActive(device: AuthorizedDevice, now: Date = new Date()): boolean {
  if (!device.isApproved) return false;
  if (device.revokedAt !== undefined && device.revokedAt <= now) return false;
  return device.expiresAt > now;
}

export function approveDevice(device: AuthorizedDevice, approvedByMemberId: string, now: Date = new Date()): AuthorizedDevice {
  return {
    ...device,
    isApproved: true,
    approvedAt: now,
    approvedByMemberId,
    revokedAt: undefined,
    expiresAt: new Date(now.getTime() + DEVICE_TRUST_DURATION_MS),
  };
}

export function touchDevice(device: AuthorizedDevice, now: Date = new Date()): AuthorizedDevice {
  return {
    ...device,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + DEVICE_TRUST_DURATION_MS),
  };
}

export function revokeDevice(device: AuthorizedDevice, now: Date = new Date()): AuthorizedDevice {
  return {
    ...device,
    isApproved: false,
    revokedAt: now,
  };
}
