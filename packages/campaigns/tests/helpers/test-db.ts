import { openDatabase, runMigrations, DatabaseConnection } from '@dispar-flux/database';

export interface SeededTestContext {
  conn: DatabaseConnection;
  organizationId: string;
  connectionId: string;
  memberId: string;
  cleanup: () => void;
}

export function createTestDatabase(): SeededTestContext {
  const conn = openDatabase({ filePath: ':memory:' });
  runMigrations(conn);

  const organizationId = 'org-test-1';
  const connectionId = 'conn-test-1';
  const memberId = 'mem-test-1';
  const now = new Date().toISOString();

  // Seed organization
  conn.prepare(`
    INSERT INTO organizations (id, name, operational_timezone, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(organizationId, 'Empresa Teste', 'America/Sao_Paulo', now, now);

  // Seed member (Owner)
  conn.prepare(`
    INSERT INTO members (id, organization_id, name, email, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(memberId, organizationId, 'Rafael Owner', 'rafael@teste.com', 'owner', 1, now, now);

  // Seed messaging connection
  conn.prepare(`
    INSERT INTO messaging_connections (id, organization_id, name, provider, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(connectionId, organizationId, 'WhatsApp Linha 1', 'baileys', 'connected', now, now);

  return {
    conn,
    organizationId,
    connectionId,
    memberId,
    cleanup: () => {
      conn.close();
    },
  };
}
