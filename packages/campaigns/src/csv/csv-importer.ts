import type { Readable } from 'node:stream';
import type { DatabaseConnection } from '@dispar-flux/database';
import {
  normalizePhoneNumber,
  generateSuppressionHash,
} from '@dispar-flux/domain';
import { ContactService } from '../contacts/contact-service.js';
import { BaseService } from '../bases/base-service.js';
import { parseCsvStream } from './csv-parser.js';
import { BaseNotFoundError } from '../errors.js';

export interface ColumnMapping {
  phoneColumn?: string;
  nameColumn?: string;
}

export interface ImportOptions {
  columnMapping?: ColumnMapping;
  defaultCountryCode?: string;
  suppressionSalt?: string;
  delimiter?: string;
}

export interface InvalidRowDetail {
  row: number;
  rawPhone?: string;
  reason: string;
}

export interface ImportSummaryReport {
  totalRows: number;
  imported: number;
  duplicatesConsolidated: number;
  invalidRows: number;
  suppressedContacts: number;
  invalidRowDetails: InvalidRowDetail[];
}

export class CsvImporter {
  private readonly contactService: ContactService;
  private readonly baseService: BaseService;

  constructor(private readonly conn: DatabaseConnection) {
    this.contactService = new ContactService(conn);
    this.baseService = new BaseService(conn);
  }

  /**
   * Imports contacts from a streaming CSV source into a Base.
   * Enforces E.164 normalization, organization-wide deduplication (ADR 0034),
   * suppression key filtering (ADR 0044), and source attribute preservation (ADR 0041).
   */
  async importStream(
    organizationId: string,
    baseId: string,
    stream: Readable | AsyncIterable<string | Buffer> | string | Buffer,
    options: ImportOptions = {}
  ): Promise<ImportSummaryReport> {
    // 1. Verify target Base exists
    const base = this.baseService.getBase(baseId);
    if (!base || base.organizationId !== organizationId) {
      throw new BaseNotFoundError(baseId);
    }

    const defaultCountryCode = options.defaultCountryCode ?? '55';

    // 2. Fetch active opt-outs for this organization (ADR 0040)
    const optOutRows = this.conn
      .prepare('SELECT normalized_phone FROM opt_outs WHERE organization_id = ? AND reauthorized_at IS NULL')
      .all(organizationId) as { normalized_phone: string }[];
    const activeOptOutPhones = new Set(optOutRows.map((o) => o.normalized_phone));

    // 3. Fetch suppression keys for this organization (ADR 0044)
    const suppressionRows = this.conn
      .prepare('SELECT hash_key FROM suppression_keys WHERE organization_id = ?')
      .all(organizationId) as { hash_key: string }[];
    const suppressionHashes = new Set(suppressionRows.map((s) => s.hash_key));

    const report: ImportSummaryReport = {
      totalRows: 0,
      imported: 0,
      duplicatesConsolidated: 0,
      invalidRows: 0,
      suppressedContacts: 0,
      invalidRowDetails: [],
    };

    let resolvedPhoneCol = options.columnMapping?.phoneColumn;
    let resolvedNameCol = options.columnMapping?.nameColumn;

    // Parse stream row by row
    const rowGenerator = parseCsvStream(stream, { delimiter: options.delimiter });

    for await (const row of rowGenerator) {
      report.totalRows++;
      const data = row.data;

      // Auto-detect columns on first row if not configured
      if (!resolvedPhoneCol) {
        resolvedPhoneCol = this.detectPhoneColumn(row.headers);
      }
      if (!resolvedNameCol) {
        resolvedNameCol = this.detectNameColumn(row.headers);
      }

      if (!resolvedPhoneCol || !data[resolvedPhoneCol]) {
        report.invalidRows++;
        report.invalidRowDetails.push({
          row: row.rowIndex,
          rawPhone: '',
          reason: `Missing phone column or empty phone value (detected phone column: "${resolvedPhoneCol ?? 'none'}")`,
        });
        continue;
      }

      const rawPhone = data[resolvedPhoneCol]!;
      const rawName = resolvedNameCol ? data[resolvedNameCol] : undefined;

      // 4. Normalize phone number using Brazilian/E.164 rules
      const normResult = normalizePhoneNumber(rawPhone, defaultCountryCode);
      if (!normResult.isValid) {
        report.invalidRows++;
        report.invalidRowDetails.push({
          row: row.rowIndex,
          rawPhone,
          reason: normResult.error ?? 'Invalid phone number format',
        });
        continue;
      }

      const normalizedPhone = normResult.e164;

      // 5. Check Pseudonymous Suppression Keys (ADR 0044)
      if (options.suppressionSalt && suppressionHashes.size > 0) {
        const hash = generateSuppressionHash(normalizedPhone, options.suppressionSalt);
        if (suppressionHashes.has(hash)) {
          report.suppressedContacts++;
          continue;
        }
      }

      // 6. Check Organization-wide Opt-Outs (ADR 0040)
      if (activeOptOutPhones.has(normalizedPhone)) {
        report.suppressedContacts++;
        continue;
      }

      // 7. Find or Create Canonical Contact (ADR 0034)
      const { contact, isNew } = this.contactService.findOrCreateContact(organizationId, {
        phone: normalizedPhone,
        name: rawName,
        defaultCountryCode,
      });

      if (isNew) {
        report.imported++;
      } else {
        report.duplicatesConsolidated++;
      }

      // 8. Store source-specific fields in base membership record (ADR 0041)
      this.baseService.addMembership(baseId, contact.id, data);
    }

    return report;
  }

  private detectPhoneColumn(headers: string[]): string | undefined {
    // Exact or near matches
    const candidates = ['telefone', 'celular', 'phone', 'whatsapp', 'mobile', 'tel', 'numero', 'fone', 'contato'];
    for (const cand of candidates) {
      const match = headers.find((h) => h.toLowerCase() === cand);
      if (match) return match;
    }
    // Substring match
    return headers.find((h) => /telefone|celular|phone|whatsapp/i.test(h));
  }

  private detectNameColumn(headers: string[]): string | undefined {
    const candidates = ['nome', 'name', 'cliente', 'razao_social', 'destinatario'];
    for (const cand of candidates) {
      const match = headers.find((h) => h.toLowerCase() === cand);
      if (match) return match;
    }
    return headers.find((h) => /nome|name/i.test(h));
  }
}
