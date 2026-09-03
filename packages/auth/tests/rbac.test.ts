import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Permission, hasPermission } from '../src/rbac/permissions.js';
import {
  assertPermission,
  canManageDevice,
  assertCanManageDevice,
} from '../src/rbac/rbac-guard.js';
import { ForbiddenError } from '../src/errors.js';

describe('RBAC Authorization Matrix (Master Plan Section 9)', () => {
  it('strictly enforces permissions for Owners and Operators', () => {
    // 1. Inbox e Resposta Manual: Owner (YES), Operator (YES)
    assert.equal(hasPermission('owner', Permission.INBOX_READ), true);
    assert.equal(hasPermission('operator', Permission.INBOX_READ), true);
    assert.equal(hasPermission('owner', Permission.INBOX_REPLY_MANUAL), true);
    assert.equal(hasPermission('operator', Permission.INBOX_REPLY_MANUAL), true);

    // 2. CRM e agenda: Owner (YES), Operator (YES)
    assert.equal(hasPermission('owner', Permission.CRM_READ), true);
    assert.equal(hasPermission('operator', Permission.CRM_READ), true);
    assert.equal(hasPermission('owner', Permission.CRM_WRITE), true);
    assert.equal(hasPermission('operator', Permission.CRM_WRITE), true);
    assert.equal(hasPermission('owner', Permission.SCHEDULE_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.SCHEDULE_MANAGE), true);

    // 3. Conexão de Mensageria: Owner (YES), Operator (NO)
    assert.equal(hasPermission('owner', Permission.CONNECTIONS_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.CONNECTIONS_MANAGE), false);

    // 4. Bases e importação: Owner (YES), Operator (NO)
    assert.equal(hasPermission('owner', Permission.BASES_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.BASES_MANAGE), false);
    assert.equal(hasPermission('owner', Permission.BASES_IMPORT), true);
    assert.equal(hasPermission('operator', Permission.BASES_IMPORT), false);

    // 5. Iniciar/alterar Campanhas: Owner (YES), Operator (NO)
    assert.equal(hasPermission('owner', Permission.CAMPAIGNS_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.CAMPAIGNS_MANAGE), false);

    // 6. Configurações e retenção: Owner (YES), Operator (NO)
    assert.equal(hasPermission('owner', Permission.SETTINGS_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.SETTINGS_MANAGE), false);
    assert.equal(hasPermission('owner', Permission.RETENTION_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.RETENTION_MANAGE), false);

    // 7. Membros e convites: Owner (YES), Operator (NO)
    assert.equal(hasPermission('owner', Permission.MEMBERS_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.MEMBERS_MANAGE), false);
    assert.equal(hasPermission('owner', Permission.INVITES_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.INVITES_MANAGE), false);

    // 8. Backup, restore e migração: Owner (YES), Operator (NO)
    assert.equal(hasPermission('owner', Permission.BACKUP_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.BACKUP_MANAGE), false);
    assert.equal(hasPermission('owner', Permission.MIGRATION_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.MIGRATION_MANAGE), false);

    // 9. Contas de Serviço: Owner (YES), Operator (NO)
    assert.equal(hasPermission('owner', Permission.SERVICE_ACCOUNTS_MANAGE), true);
    assert.equal(hasPermission('operator', Permission.SERVICE_ACCOUNTS_MANAGE), false);

    // 10. assertPermission throws ForbiddenError on unauthorized access
    assert.doesNotThrow(() => assertPermission('owner', Permission.CAMPAIGNS_MANAGE));
    assert.throws(
      () => assertPermission('operator', Permission.CAMPAIGNS_MANAGE),
      (err: unknown) => err instanceof ForbiddenError
    );
  });

  it('enforces device management scope: Owner can manage all, Operator can only manage own device', () => {
    const ownerActor = { id: 'owner-1', role: 'owner' as const };
    const operatorActor1 = { id: 'operator-1', role: 'operator' as const };

    // Owner can manage any device
    assert.equal(canManageDevice(ownerActor, 'operator-1'), true);
    assert.equal(canManageDevice(ownerActor, 'operator-2'), true);
    assert.equal(canManageDevice(ownerActor, 'owner-1'), true);

    // Operator can ONLY manage their own device
    assert.equal(canManageDevice(operatorActor1, 'operator-1'), true);
    assert.equal(canManageDevice(operatorActor1, 'operator-2'), false);
    assert.equal(canManageDevice(operatorActor1, 'owner-1'), false);

    // assertCanManageDevice throws ForbiddenError when operator tries to manage another member's device
    assert.doesNotThrow(() => assertCanManageDevice(operatorActor1, 'operator-1'));
    assert.throws(
      () => assertCanManageDevice(operatorActor1, 'operator-2'),
      (err: unknown) => err instanceof ForbiddenError
    );
  });
});
