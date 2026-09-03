import { Readable } from 'node:stream';
import type { DatabaseConnection } from '@dispar-flux/database';
import { BaseService } from '../bases/base-service.js';
import { BaseNotFoundError } from '../errors.js';

export interface ExportOptions {
  delimiter?: string;
  includeCanonicalOnly?: boolean;
}

export class CsvExporter {
  private readonly baseService: BaseService;

  constructor(private readonly conn: DatabaseConnection) {
    this.baseService = new BaseService(conn);
  }

  /**
   * Exports base contacts and membership attributes as a CSV formatted string.
   */
  exportToString(baseId: string, options: ExportOptions = {}): string {
    const base = this.baseService.getBase(baseId);
    if (!base) {
      throw new BaseNotFoundError(baseId);
    }

    const memberships = this.baseService.listMemberships(baseId);
    const delimiter = options.delimiter ?? ',';

    // Collect all dynamic imported field names across all members
    const dynamicFieldKeys = new Set<string>();
    if (!options.includeCanonicalOnly) {
      for (const m of memberships) {
        for (const key of Object.keys(m.importedFields)) {
          dynamicFieldKeys.add(key);
        }
      }
    }

    const baseHeaders = ['phone', 'name'];
    const allHeaders = [...baseHeaders, ...Array.from(dynamicFieldKeys)];

    const lines: string[] = [];
    // Header line
    lines.push(allHeaders.map((h) => escapeCsvValue(h, delimiter)).join(delimiter));

    // Data rows
    for (const m of memberships) {
      const rowValues = allHeaders.map((header) => {
        if (header === 'phone') {
          return m.contact.normalizedPhone;
        }
        if (header === 'name') {
          return m.contact.name ?? '';
        }
        const val = m.importedFields[header];
        if (val === undefined || val === null) return '';
        if (typeof val === 'object') return JSON.stringify(val);
        return String(val);
      });

      lines.push(rowValues.map((v) => escapeCsvValue(v, delimiter)).join(delimiter));
    }

    return lines.join('\r\n') + '\r\n';
  }

  /**
   * Exports base contacts and attributes as a streaming Readable.
   */
  exportToStream(baseId: string, options: ExportOptions = {}): Readable {
    const csvContent = this.exportToString(baseId, options);
    return Readable.from([csvContent]);
  }
}

function escapeCsvValue(val: string, delimiter: string): string {
  if (
    val.includes(delimiter) ||
    val.includes('"') ||
    val.includes('\n') ||
    val.includes('\r')
  ) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
