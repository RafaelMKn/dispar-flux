import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createSuppressionKey, createOptOut } from '@dispar-flux/domain';
import { CsvImporter } from '../src/csv/csv-importer.js';
import { CsvExporter } from '../src/csv/csv-exporter.js';
import { BaseService } from '../src/bases/base-service.js';
import { ContactService } from '../src/contacts/contact-service.js';
import { parseCsvStream } from '../src/csv/csv-parser.js';
import { createTestDatabase, type SeededTestContext } from './helpers/test-db.js';

describe('CSV Streaming Importer & Exporter', () => {
  let ctx: SeededTestContext;
  let baseService: BaseService;
  let contactService: ContactService;
  let importer: CsvImporter;
  let exporter: CsvExporter;

  beforeEach(() => {
    ctx = createTestDatabase();
    baseService = new BaseService(ctx.conn);
    contactService = new ContactService(ctx.conn);
    importer = new CsvImporter(ctx.conn);
    exporter = new CsvExporter(ctx.conn);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('Streaming CSV Parser', () => {
    it('parses CSV streams with quotes, commas, semicolons, and CRLF line endings', async () => {
      const csvData = [
        'nome,telefone,cidade\r\n',
        '"Silva, Maria",11987654321,"São Paulo"\r\n',
        'João Santos,21988887777,"Rio de Janeiro"\r\n',
      ];

      const stream = Readable.from(csvData);
      const rows = [];
      for await (const row of parseCsvStream(stream)) {
        rows.push(row);
      }

      assert.equal(rows.length, 2);
      assert.equal(rows[0]!.data['nome'], 'Silva, Maria');
      assert.equal(rows[0]!.data['telefone'], '11987654321');
      assert.equal(rows[0]!.data['cidade'], 'São Paulo');
      assert.equal(rows[1]!.data['nome'], 'João Santos');
    });

    it('handles semicolon delimiter and escaped quotes ("")', async () => {
      const csvData = 'nome;telefone;mensagem\n"Dr. ""House""";11999998888;"Aviso; urgente"\n';
      const rows = [];
      for await (const row of parseCsvStream(csvData)) {
        rows.push(row);
      }

      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.data['nome'], 'Dr. "House"');
      assert.equal(rows[0]!.data['telefone'], '11999998888');
      assert.equal(rows[0]!.data['mensagem'], 'Aviso; urgente');
    });
  });

  describe('CsvImporter: Normalization, Deduplication, and Suppression', () => {
    it('imports streaming CSV, normalizes Brazilian phones, consolidates duplicates, and reports summary', async () => {
      const base = baseService.createBase({
        organizationId: ctx.organizationId,
        name: 'Campanha Black Friday',
        provenance: 'Leads Landing Page',
        purpose: 'Disparo de cupom promocional',
      });

      // Seed an existing contact in the organization to verify deduplication (ADR 0034)
      contactService.findOrCreateContact(ctx.organizationId, {
        phone: '+5511988881111',
        name: 'Cliente Antigo Canonical',
      });

      // CSV containing:
      // 1. New valid mobile missing 9th digit (1187654321 -> +5511987654321)
      // 2. Duplicate of the existing contact (11988881111) with extra column data
      // 3. Invalid phone number (dummy repeated digits)
      // 4. Missing phone value
      // 5. Another valid contact
      const csvContent = [
        'nome,telefone,plano,cargo\n',
        'Novo Cliente,1187654321,Pro,Gerente\n',
        'Cliente Antigo Atualizado,11988881111,Enterprise,Diretor\n',
        'Numero Invalido,00000000000,Free,Analista\n',
        'Sem Telefone,,Pro,Coordenador\n',
        'Segundo Novo,21977776666,Pro,Engenheiro\n',
      ].join('');

      const stream = Readable.from([csvContent]);
      const report = await importer.importStream(ctx.organizationId, base.id, stream);

      assert.equal(report.totalRows, 5);
      assert.equal(report.imported, 2, 'Should create 2 new canonical contacts');
      assert.equal(report.duplicatesConsolidated, 1, 'Should consolidate 1 existing contact');
      assert.equal(report.invalidRows, 2, 'Should flag 2 invalid rows');
      assert.equal(report.suppressedContacts, 0);

      // Verify canonical profile was NOT overwritten by the duplicate import (ADR 0041)
      const existing = contactService.findByPhone(ctx.organizationId, '+5511988881111')!;
      assert.equal(existing.name, 'Cliente Antigo Canonical', 'Canonical name must be preserved');

      // Verify that source-specific fields were stored in base_memberships
      const members = baseService.listMemberships(base.id);
      assert.equal(members.length, 3, 'Base should have 3 total memberships (2 new + 1 consolidated)');

      const consolidatedMember = members.find((m) => m.contact.normalizedPhone === '+5511988881111');
      assert.ok(consolidatedMember);
      assert.equal(consolidatedMember.importedFields['cargo'], 'Diretor');
      assert.equal(consolidatedMember.importedFields['plano'], 'Enterprise');
    });

    it('enforces pseudonymous suppression keys (ADR 0044) and active opt-outs (ADR 0040)', async () => {
      const base = baseService.createBase({
        organizationId: ctx.organizationId,
        name: 'Base Com Supressoes',
        provenance: 'Auditoria LGPD',
        purpose: 'Teste de supressão',
      });

      const salt = 'test-secret-salt-2026';
      const suppressedPhone = '+5511999991111';
      const optedOutPhone = '+5511999992222';
      const normalPhone = '+5511999993333';

      // 1. Register pseudonymous suppression key in DB (ADR 0044)
      const suppressionKey = createSuppressionKey({
        id: 'sk-1',
        organizationId: ctx.organizationId,
        normalizedPhone: suppressedPhone,
        salt,
      });
      ctx.conn.prepare(`
        INSERT INTO suppression_keys (id, organization_id, hash_key, created_at)
        VALUES (?, ?, ?, ?)
      `).run(suppressionKey.id, suppressionKey.organizationId, suppressionKey.hashKey, new Date().toISOString());

      // 2. Register active opt-out in DB (ADR 0040)
      const optOut = createOptOut({
        id: 'opt-1',
        organizationId: ctx.organizationId,
        normalizedPhone: optedOutPhone,
        reason: 'Solicitou parada de envio',
      });
      ctx.conn.prepare(`
        INSERT INTO opt_outs (id, organization_id, normalized_phone, reason, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(optOut.id, optOut.organizationId, optOut.normalizedPhone, optOut.reason, new Date().toISOString());

      // CSV contains: suppressed phone, opted-out phone, and normal phone
      const csvContent = [
        'nome,telefone\n',
        `Pessoa Deletada,${suppressedPhone}\n`,
        `Pessoa OptouSair,${optedOutPhone}\n`,
        `Pessoa Valida,${normalPhone}\n`,
      ].join('');

      const report = await importer.importStream(ctx.organizationId, base.id, csvContent, {
        suppressionSalt: salt,
      });

      assert.equal(report.totalRows, 3);
      assert.equal(report.suppressedContacts, 2, 'Must block 1 suppressed and 1 opted-out contact from import');
      assert.equal(report.imported, 1, 'Only the eligible contact is imported');

      const members = baseService.listMemberships(base.id);
      assert.equal(members.length, 1);
      assert.equal(members[0]!.contact.normalizedPhone, normalPhone);
    });
  });

  describe('CsvExporter', () => {
    it('exports base contacts and membership attributes to CSV format', async () => {
      const base = baseService.createBase({
        organizationId: ctx.organizationId,
        name: 'Export Base',
        provenance: 'Teste Exporter',
        purpose: 'Validar exportador',
      });

      const { contact: c1 } = contactService.findOrCreateContact(ctx.organizationId, {
        phone: '11987654321',
        name: 'Maria Silva',
      });
      baseService.addMembership(base.id, c1.id, { empresa: 'Acme Inc', pontuacao: 95 });

      const { contact: c2 } = contactService.findOrCreateContact(ctx.organizationId, {
        phone: '21988887777',
        name: 'João Santos',
      });
      baseService.addMembership(base.id, c2.id, { empresa: 'Beta Corp', pontuacao: 80 });

      const exportedString = exporter.exportToString(base.id);
      assert.ok(exportedString.includes('phone,name,empresa,pontuacao') || exportedString.includes('phone,name,pontuacao,empresa'));
      assert.ok(exportedString.includes('+5511987654321,Maria Silva'));
      assert.ok(exportedString.includes('+5521988887777,João Santos'));

      // Test streaming export
      const stream = exporter.exportToStream(base.id);
      let streamedData = '';
      for await (const chunk of stream) {
        streamedData += chunk.toString();
      }
      assert.equal(streamedData, exportedString);
    });
  });
});
