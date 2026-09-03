import type { MemberRole } from '@dispar-flux/domain';

export enum Permission {
  // Inbox e Resposta Manual (Owner: sim, Operator: sim)
  INBOX_READ = 'inbox:read',
  INBOX_REPLY_MANUAL = 'inbox:reply_manual',

  // CRM e agenda (Owner: sim, Operator: sim)
  CRM_READ = 'crm:read',
  CRM_WRITE = 'crm:write',
  SCHEDULE_MANAGE = 'schedule:manage',

  // Conexão de Mensageria (Owner: sim, Operator: não)
  CONNECTIONS_MANAGE = 'connections:manage',

  // Bases e importação (Owner: sim, Operator: não)
  BASES_MANAGE = 'bases:manage',
  BASES_IMPORT = 'bases:import',

  // iniciar/alterar Campanhas (Owner: sim, Operator: não)
  CAMPAIGNS_MANAGE = 'campaigns:manage',

  // configurações e retenção (Owner: sim, Operator: não)
  SETTINGS_MANAGE = 'settings:manage',
  RETENTION_MANAGE = 'retention:manage',

  // membros e convites (Owner: sim, Operator: não)
  MEMBERS_MANAGE = 'members:manage',
  INVITES_MANAGE = 'invites:manage',

  // Dispositivos (Owner: all, Operator: próprio dispositivo apenas)
  DEVICES_MANAGE_ALL = 'devices:manage_all',
  DEVICES_MANAGE_OWN = 'devices:manage_own',

  // backup, restore e migração (Owner: sim, Operator: não)
  BACKUP_MANAGE = 'backup:manage',
  MIGRATION_MANAGE = 'migration:manage',

  // Contas de Serviço (Owner: sim, Operator: não)
  SERVICE_ACCOUNTS_MANAGE = 'service_accounts:manage',
}

export const OPERATOR_PERMISSIONS: ReadonlySet<Permission> = new Set([
  Permission.INBOX_READ,
  Permission.INBOX_REPLY_MANUAL,
  Permission.CRM_READ,
  Permission.CRM_WRITE,
  Permission.SCHEDULE_MANAGE,
  Permission.DEVICES_MANAGE_OWN,
]);

export const OWNER_PERMISSIONS: ReadonlySet<Permission> = new Set(Object.values(Permission));

/**
 * Checks if a member role has access to a specific permission per Section 9 matrix.
 */
export function hasPermission(role: MemberRole, permission: Permission): boolean {
  if (role === 'owner') {
    return true;
  }
  if (role === 'operator') {
    return OPERATOR_PERMISSIONS.has(permission);
  }
  return false;
}
