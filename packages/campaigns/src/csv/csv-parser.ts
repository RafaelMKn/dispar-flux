import { Readable } from 'node:stream';

export interface CsvParseOptions {
  delimiter?: string;
  skipEmptyLines?: boolean;
}

export interface ParsedCsvRow {
  rowIndex: number;
  data: Record<string, string>;
  headers: string[];
}

/**
 * Streaming RFC 4180 compliant CSV parser.
 * Supports comma and semicolon delimiters, quoted fields with commas, newlines, and escaped quotes ("").
 */
export async function* parseCsvStream(
  input: Readable | AsyncIterable<string | Buffer> | string | Buffer,
  options: CsvParseOptions = {}
): AsyncGenerator<ParsedCsvRow, void, unknown> {
  let asyncIterable: AsyncIterable<string | Buffer>;

  if (typeof input === 'string' || Buffer.isBuffer(input)) {
    const text = typeof input === 'string' ? input : input.toString('utf-8');
    asyncIterable = (async function* () {
      yield text;
    })();
  } else {
    asyncIterable = input;
  }

  let delimiter = options.delimiter;
  let headers: string[] | null = null;
  let buffer = '';
  let inQuotes = false;
  let rowIndex = 0;

  for await (const chunk of asyncIterable) {
    const textChunk = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    buffer += textChunk;

    // Process complete rows from buffer
    let cursor = 0;
    while (cursor < buffer.length) {
      const char = buffer[cursor];

      if (char === '"') {
        // Look ahead for escaped quote
        if (inQuotes && cursor + 1 < buffer.length && buffer[cursor + 1] === '"') {
          cursor += 2;
          continue;
        }
        inQuotes = !inQuotes;
        cursor++;
        continue;
      }

      if (!inQuotes && (char === '\n' || (char === '\r' && cursor + 1 < buffer.length && buffer[cursor + 1] === '\n'))) {
        const lineEnd = cursor;
        const line = buffer.slice(0, lineEnd);
        const nextStart = char === '\r' ? cursor + 2 : cursor + 1;
        buffer = buffer.slice(nextStart);
        cursor = 0;

        const rowValues = parseCsvLine(line, delimiter);
        if (!rowValues) continue;

        if (headers === null) {
          // Detect delimiter from first row if not provided
          if (!delimiter) {
            delimiter = detectDelimiter(line);
            // Re-parse header line with detected delimiter
            headers = parseCsvLine(line, delimiter)!.map((h) => cleanHeader(h));
          } else {
            headers = rowValues.map((h) => cleanHeader(h));
          }
          continue;
        }

        // Data row
        rowIndex++;
        const rowRecord: Record<string, string> = {};
        for (let i = 0; i < headers.length; i++) {
          const headerKey = headers[i];
          if (headerKey) {
            rowRecord[headerKey] = rowValues[i] !== undefined ? rowValues[i]!.trim() : '';
          }
        }

        yield {
          rowIndex,
          data: rowRecord,
          headers,
        };
        continue;
      }

      cursor++;
    }
  }

  // Process remaining buffer if non-empty
  if (buffer.length > 0) {
    const line = buffer.replace(/[\r\n]+$/, '');
    if (line.trim().length > 0) {
      if (headers === null) {
        if (!delimiter) delimiter = detectDelimiter(line);
        headers = parseCsvLine(line, delimiter)!.map((h) => cleanHeader(h));
      } else {
        rowIndex++;
        const rowValues = parseCsvLine(line, delimiter ?? ',');
        if (rowValues) {
          const rowRecord: Record<string, string> = {};
          for (let i = 0; i < headers.length; i++) {
            const headerKey = headers[i];
            if (headerKey) {
              rowRecord[headerKey] = rowValues[i] !== undefined ? rowValues[i]!.trim() : '';
            }
          }
          yield {
            rowIndex,
            data: rowRecord,
            headers,
          };
        }
      }
    }
  }
}

function detectDelimiter(headerLine: string): string {
  // Strip BOM
  const cleaned = headerLine.replace(/^\uFEFF/, '');
  const semicolonCount = (cleaned.match(/;/g) || []).length;
  const commaCount = (cleaned.match(/,/g) || []).length;
  return semicolonCount > commaCount ? ';' : ',';
}

function cleanHeader(h: string): string {
  return h.replace(/^\uFEFF/, '').trim();
}

/**
 * Parses a single CSV line into an array of string values.
 */
export function parseCsvLine(line: string, delimiter = ','): string[] | null {
  const trimmed = line.replace(/^\uFEFF/, '').trim();
  if (!trimmed) return null;

  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        // Escaped quote
        cur += '"';
        i += 2;
        continue;
      }
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (!inQuotes && line.slice(i, i + delimiter.length) === delimiter) {
      result.push(cur.trim());
      cur = '';
      i += delimiter.length;
      continue;
    }

    cur += char;
    i++;
  }

  result.push(cur.trim());
  return result;
}
