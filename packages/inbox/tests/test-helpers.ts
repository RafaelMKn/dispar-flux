import { openDatabase, runMigrations, type DatabaseConnection } from '@dispar-flux/database';

export interface TestContext {
  conn: DatabaseConnection;
  organizationId: string;
  ownerId: string;
  operatorId: string;
  connection1Id: string;
  connection2Id: string;
  contact1Id: string;
  contact2Id: string;
}

export function setupTestDatabase(): TestContext {
  const conn = openDatabase({ filePath: ':memory:' });
  runMigrations(conn);

  const now = new Date().toISOString();
  const organizationId = 'org_test_1';
  const ownerId = 'mem_owner_1';
  const operatorId = 'mem_operator_1';
  const connection1Id = 'conn_wa_1';
  const connection2Id = 'conn_wa_2';
  const contact1Id = 'cnt_ana_1';
  const contact2Id = 'cnt_bruno_2';

  // 1. Organization
  conn.prepare(`
    INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(organizationId, 'Empresa Teste LTDA', 'America/Sao_Paulo', now, now);

  // 2. Members (Owner & Operator)
  conn.prepare(`
    INSERT INTO members (id, organization_id, name, email, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(ownerId, organizationId, 'Carlos Owner', 'carlos@empresa.com', 'owner', now, now);

  conn.prepare(`
    INSERT INTO members (id, organization_id, name, email, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(operatorId, organizationId, 'Julia Operator', 'julia@empresa.com', 'operator', now, now);

  // 3. Messaging Connections (2 connections to test partitioning)
  conn.prepare(`
    INSERT INTO messaging_connections (id, organization_id, name, provider, status, phone_number, created_at, updated_at)
    VALUES (?, ?, ?, 'baileys', 'connected', '5511999990001', ?, ?)
  `).run(connection1Id, organizationId, 'WhatsApp Comercial 1', now, now);

  conn.prepare(`
    INSERT INTO messaging_connections (id, organization_id, name, provider, status, phone_number, created_at, updated_at)
    VALUES (?, ?, ?, 'baileys', 'connected', '5511999990002', ?, ?)
  `).run(connection2Id, organizationId, 'WhatsApp Suporte 2', now, now);

  // 4. Contacts
  conn.prepare(`
    INSERT INTO contacts (id, organization_id, normalized_phone, name, is_opted_out, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(contact1Id, organizationId, '5511988881111', 'Ana Silva', now, now);

  conn.prepare(`
    INSERT INTO contacts (id, organization_id, normalized_phone, name, is_opted_out, created_at, updated_at)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(contact2Id, organizationId, '5511988882222', 'Bruno Souza', now, now);

  return {
    conn,
    organizationId,
    ownerId,
    operatorId,
    connection1Id,
    connection2Id,
    contact1Id,
    contact2Id,
  };
}
