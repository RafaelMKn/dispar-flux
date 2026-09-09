import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createSuppressionKey, createOptOut } from '@dispar-flux/domain';
import { CsvImporter } from '../src/csv/csv-importer.js';
import {
  CsvExporter,
  escapeCsvValue,
  neutralizeCsvFormula,
  isSafeNumericLiteral,
} from '../src/csv/csv-exporter.js';
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

    describe('Formula Injection Neutralization (OWASP)', () => {
      it('neutralizes malicious formula injection payloads (=, +, -, @, \\t, \\r)', () => {
        // Equals '='
        assert.equal(neutralizeCsvFormula("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
        assert.equal(neutralizeCsvFormula('=1+1'), "'=1+1");
        assert.equal(neutralizeCsvFormula('=HYPERLINK("http://evil.com")'), "'=HYPERLINK(\"http://evil.com\")");
        assert.equal(neutralizeCsvFormula('  =cmd'), "'  =cmd");

        // At '@'
        assert.equal(neutralizeCsvFormula('@SUM(1,2)'), "'@SUM(1,2)");
        assert.equal(neutralizeCsvFormula('@A1'), "'@A1");
        assert.equal(neutralizeCsvFormula('  @SUM(A1:B5)'), "'  @SUM(A1:B5)");

        // Plus '+' with malicious non-numeric expression
        assert.equal(neutralizeCsvFormula('+cmd'), "'+cmd");
        assert.equal(neutralizeCsvFormula("+cmd|' /C calc'!A0"), "'+cmd|' /C calc'!A0");
        assert.equal(neutralizeCsvFormula('+1+1'), "'+1+1");
        assert.equal(neutralizeCsvFormula('+SUM(A1:B1)'), "'+SUM(A1:B1)");
        assert.equal(neutralizeCsvFormula('+'), "'+");
        assert.equal(neutralizeCsvFormula('  +cmd'), "'  +cmd");

        // Minus '-' with malicious non-numeric expression
        assert.equal(neutralizeCsvFormula('-2+3*cmd'), "'-2+3*cmd");
        assert.equal(neutralizeCsvFormula("-cmd|' /C calc'!A0"), "'-cmd|' /C calc'!A0");
        assert.equal(neutralizeCsvFormula('-1-1'), "'-1-1");
        assert.equal(neutralizeCsvFormula('-cmd'), "'-cmd");
        assert.equal(neutralizeCsvFormula('-'), "'-");
        assert.equal(neutralizeCsvFormula('  -2+3*cmd'), "'  -2+3*cmd");

        // Tab '\t'
        assert.equal(neutralizeCsvFormula('\t=cmd'), "'\t=cmd");
        assert.equal(neutralizeCsvFormula('\tcalc'), "'\tcalc");
        assert.equal(neutralizeCsvFormula('  \tcalc'), "'  \tcalc");
        assert.equal(neutralizeCsvFormula('\t123'), "'\t123");

        // Carriage return '\r'
        assert.equal(neutralizeCsvFormula('\r=cmd'), "'\r=cmd");
        assert.equal(neutralizeCsvFormula('\rcalc'), "'\rcalc");
        assert.equal(neutralizeCsvFormula('  \rcalc'), "'  \rcalc");
      });

      it('preserves valid numeric literals, negative numbers, and E.164 phone numbers', () => {
        // E.164 phone numbers (start with + followed only by digits)
        assert.equal(neutralizeCsvFormula('+5511987654321'), '+5511987654321');
        assert.equal(neutralizeCsvFormula('+5521988887777'), '+5521988887777');
        assert.equal(neutralizeCsvFormula('+14155552671'), '+14155552671');

        // Negative integers and floats
        assert.equal(neutralizeCsvFormula('-42'), '-42');
        assert.equal(neutralizeCsvFormula('-123.45'), '-123.45');
        assert.equal(neutralizeCsvFormula('-0.5'), '-0.5');
        assert.equal(neutralizeCsvFormula('-.5'), '-.5');
        assert.equal(neutralizeCsvFormula('-0'), '-0');

        // Positive integers and floats with explicit +
        assert.equal(neutralizeCsvFormula('+42'), '+42');
        assert.equal(neutralizeCsvFormula('+123.45'), '+123.45');
        assert.equal(neutralizeCsvFormula('+0.5'), '+0.5');
        assert.equal(neutralizeCsvFormula('+.5'), '+.5');
        assert.equal(neutralizeCsvFormula('+0'), '+0');

        // Numbers with leading/trailing spaces
        assert.equal(neutralizeCsvFormula('  -42  '), '  -42  ');
        assert.equal(neutralizeCsvFormula('  +5511987654321  '), '  +5511987654321  ');

        // Scientific notation
        assert.equal(neutralizeCsvFormula('1e5'), '1e5');
        assert.equal(neutralizeCsvFormula('-1e5'), '-1e5');
        assert.equal(neutralizeCsvFormula('+2.5E-3'), '+2.5E-3');

        // Standard unsigned numbers
        assert.equal(neutralizeCsvFormula('123'), '123');
        assert.equal(neutralizeCsvFormula('0'), '0');
        assert.equal(neutralizeCsvFormula('99.9'), '99.9');
      });

      it('preserves normal text, UTF-8, quotes, and formula characters in non-leading positions', () => {
        assert.equal(neutralizeCsvFormula('Maria Silva'), 'Maria Silva');
        assert.equal(neutralizeCsvFormula('João Santos'), 'João Santos');
        assert.equal(neutralizeCsvFormula('São Paulo 🔥'), 'São Paulo 🔥');
        assert.equal(neutralizeCsvFormula('user@example.com'), 'user@example.com');
        assert.equal(neutralizeCsvFormula('key=value'), 'key=value');
        assert.equal(neutralizeCsvFormula('A+B'), 'A+B');
        assert.equal(neutralizeCsvFormula('10-5'), '10-5');
        assert.equal(neutralizeCsvFormula("'already_quoted"), "'already_quoted");
        assert.equal(neutralizeCsvFormula(''), '');
      });

      it('escapeCsvValue neutralizes formulas and handles CSV quoting / escaping correctly', () => {
        // Formula with delimiter
        assert.equal(escapeCsvValue('=SUM(1, 2)', ','), '"\'=SUM(1, 2)"');

        // Formula with quotes
        assert.equal(
          escapeCsvValue('=HYPERLINK("http://evil.com", "click")', ','),
          '"\'=HYPERLINK(""http://evil.com"", ""click"")"'
        );

        // Formula with semicolon delimiter
        assert.equal(escapeCsvValue('@SUM(1; 2)', ';'), '"\'@SUM(1; 2)"');

        // Formula with newline / carriage return
        assert.equal(escapeCsvValue('\r=cmd', ','), '"\'\r=cmd"');

        // Standard text with quotes and delimiters
        assert.equal(escapeCsvValue('Dr. "House"', ','), '"Dr. ""House"""');
        assert.equal(escapeCsvValue('Silva, Maria', ','), '"Silva, Maria"');

        // Safe phone number with comma delimiter
        assert.equal(escapeCsvValue('+5511987654321', ','), '+5511987654321');

        // Safe negative number with comma delimiter
        assert.equal(escapeCsvValue('-150.50', ','), '-150.50');
      });

      it('safely exports contacts with formula injection payloads in names and dynamic fields', async () => {
        const base = baseService.createBase({
          organizationId: ctx.organizationId,
          name: 'Malicious Input Base',
          provenance: 'Security Testing',
          purpose: 'CSV Injection Verification',
        });

        // Contact 1: Malicious name starting with '=' and dynamic field with '+cmd'
        const { contact: c1 } = contactService.findOrCreateContact(ctx.organizationId, {
          phone: '11987654321',
          name: "=cmd|' /C calc'!A0",
        });
        baseService.addMembership(base.id, c1.id, {
          payload_plus: "+cmd|' /C calc'!A0",
          saldo: -150.5,
          pontuacao: 100,
        });

        // Contact 2: Malicious name starting with '@' and dynamic fields with '-' and '\\t'
        const { contact: c2 } = contactService.findOrCreateContact(ctx.organizationId, {
          phone: '21988887777',
          name: '@SUM(1,2)',
        });
        baseService.addMembership(base.id, c2.id, {
          payload_minus: '-2+3*cmd',
          payload_tab: '\t=cmd',
          empresa: 'Normal Corp',
        });

        const exportedString = exporter.exportToString(base.id);

        // Verify header exists
        assert.ok(exportedString.startsWith('phone,name,'));

        // Verify E.164 phone numbers remain unquoted and unneutralized (pure digits)
        assert.ok(exportedString.includes('+5511987654321,'));
        assert.ok(exportedString.includes('+5521988887777,'));

        // Verify malicious contact names are neutralized with single quote prefix
        assert.ok(
          exportedString.includes("'+5511987654321") === false,
          'Phone number must not be prefixed with apostrophe'
        );
        assert.ok(exportedString.includes("'=cmd|' /C calc'!A0"));
        assert.ok(exportedString.includes("'@SUM(1,2)"));

        // Verify malicious dynamic fields are neutralized
        assert.ok(exportedString.includes("'+cmd|' /C calc'!A0"));
        assert.ok(exportedString.includes("'-2+3*cmd"));
        assert.ok(exportedString.includes("'\t=cmd"));

        // Verify legitimate negative number and positive number are preserved
        assert.ok(exportedString.includes('-150.5'));
        assert.ok(exportedString.includes('100'));
        assert.ok(!exportedString.includes("'-150.5"));
        assert.ok(!exportedString.includes("'100"));

        // Verify streaming export matches exportToString
        const stream = exporter.exportToStream(base.id);
        let streamedData = '';
        for await (const chunk of stream) {
          streamedData += chunk.toString();
        }
        assert.equal(streamedData, exportedString);

        // Verify parsing back with parseCsvStream round-trips correctly without syntax errors
        const parsedRows = [];
        for await (const row of parseCsvStream(streamedData)) {
          parsedRows.push(row);
        }
        assert.equal(parsedRows.length, 2);

        const r1 = parsedRows.find((r) => r.data['phone'] === '+5511987654321');
        assert.ok(r1);
        assert.equal(r1.data['name'], "'=cmd|' /C calc'!A0");
        assert.equal(r1.data['payload_plus'], "'+cmd|' /C calc'!A0");
        assert.equal(r1.data['saldo'], '-150.5');

        const r2 = parsedRows.find((r) => r.data['phone'] === '+5521988887777');
        assert.ok(r2);
        assert.equal(r2.data['name'], "'@SUM(1,2)");
        assert.equal(r2.data['payload_minus'], "'-2+3*cmd");
        assert.equal(r2.data['payload_tab'], "'\t=cmd");
        assert.equal(r2.data['empresa'], 'Normal Corp');
      });
    });
  });
});
