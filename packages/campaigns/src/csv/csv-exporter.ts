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

const FORMULA_TRIGGER_CHARS = ['=', '+', '-', '@', '\t', '\r'];
const NUMERIC_REGEX = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * Checks whether a string is a safe numeric literal (e.g. -42, +123, -12.34, +5511987654321).
 * Safe numeric literals do not trigger formula execution in spreadsheet applications.
 */
export function isSafeNumericLiteral(val: string): boolean {
  if (val.includes('\t') || val.includes('\r') || val.includes('\n')) {
    return false;
  }
  const trimmed = val.trim();
  if (!trimmed) return false;
  return NUMERIC_REGEX.test(trimmed);
}

/**
 * Neutralizes spreadsheet formula injection payloads according to OWASP guidelines.
 * If a value begins with =, +, -, @, \t, or \r (directly or after leading whitespace),
 * it is prefixed with a single quote (') unless it is a safe numeric literal
 * (e.g. negative numbers like -42 or E.164 phone numbers like +5511999999999).
 */
export function neutralizeCsvFormula(val: string): string {
  if (!val) return val;

  const trimmedStart = val.trimStart();
  const trimmedSpacesOnly = val.replace(/^[ \u00A0]+/, '');

  const startsWithTrigger =
    FORMULA_TRIGGER_CHARS.some((ch) => val.startsWith(ch)) ||
    FORMULA_TRIGGER_CHARS.some((ch) => trimmedSpacesOnly.startsWith(ch)) ||
    FORMULA_TRIGGER_CHARS.some((ch) => trimmedStart.startsWith(ch));

  if (!startsWithTrigger) {
    return val;
  }

  // Safe if strictly a valid number (e.g. -42, +123, -12.34, +5511987654321)
  if (isSafeNumericLiteral(val)) {
    return val;
  }

  return `'${val}`;
}

/**
 * Neutralizes formula injection characters and escapes CSV delimiter/quotes/newlines.
 */
export function escapeCsvValue(val: string, delimiter: string): string {
  const sanitized = neutralizeCsvFormula(val);
  if (
    sanitized.includes(delimiter) ||
    sanitized.includes('"') ||
    sanitized.includes('\n') ||
    sanitized.includes('\r')
  ) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }
  return sanitized;
}

