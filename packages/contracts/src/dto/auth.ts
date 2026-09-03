import type { MemberRole } from '@dispar-flux/domain';

export interface RetentionPolicyDaysDto {
  messagesDays: number;
  mediaDays: number;
  logsDays: number;
}

export interface ClaimInstallationRequest {
  claimCode: string;
  organizationName: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
  operationalTimezone: string; // e.g. "America/Sao_Paulo"
  retentionPolicyDays?: RetentionPolicyDaysDto;
}

export interface ClaimInstallationResponse {
  organizationId: string;
  ownerId: string;
  token?: string;
  recoveryKeyGuidance: string;
  message: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  deviceFingerprint: string;
  deviceName?: string;
}

export interface AuthenticatedMemberDto {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
}

export interface LoginResponse {
  token: string;
  member: AuthenticatedMemberDto;
  deviceId: string;
  requiresDeviceApproval?: boolean;
}

export interface CreateInviteRequest {
  role: MemberRole;
  expiresInHours?: number;
}

export interface CreateInviteResponse {
  inviteId: string;
  code: string;
  expiresAt: string;
  role: MemberRole;
}

export interface AcceptInviteRequest {
  code: string;
  name: string;
  email: string;
  password: string;
  deviceFingerprint: string;
  deviceName?: string;
}

export interface AcceptInviteResponse {
  memberId: string;
  token: string;
  deviceId: string;
}

export interface DeviceApprovalRequest {
  deviceId: string;
  approve: boolean;
}

export interface DeviceApprovalResponse {
  deviceId: string;
  isApproved: boolean;
  approvedAt?: string;
}
