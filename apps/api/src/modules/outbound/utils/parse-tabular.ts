import ExcelJS from 'exceljs';
import {
  OUTBOUND_IMPORT_HEADER_ALIASES,
  OUTBOUND_IMPORT_KINDS,
  OUTBOUND_IMPORT_MAX_ROWS,
  type OutboundImportKind,
  type OutboundImportTargetField,
} from '../outbound-import.constants';

export type TabularParseResult = {
  kind: OutboundImportKind;
  headers: string[];
  rows: string[][];
};

export function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '');
}

export function normalizeHeaderKey(header: string): string {
  return stripAccents(header)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export function guessColumnMapping(
  headers: string[],
): Partial<Record<OutboundImportTargetField, string>> {
  const mapping: Partial<Record<OutboundImportTargetField, string>> = {};
  for (const header of headers) {
    const key = normalizeHeaderKey(header);
    const target = OUTBOUND_IMPORT_HEADER_ALIASES[key];
    if (target && !mapping[target]) {
      mapping[target] = header;
    }
  }
  return mapping;
}

/** Minimal CSV parser (UTF-8): supports comma/semicolon, quoted fields. */
export function parseCsvBuffer(buffer: Buffer): TabularParseResult {
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delimiter = detectDelimiter(text);
  const matrix = parseDelimited(text, delimiter);
  return toTabular(OUTBOUND_IMPORT_KINDS.CSV, matrix);
}

export async function parseXlsxBuffer(
  buffer: Buffer,
): Promise<TabularParseResult> {
  const workbook = new ExcelJS.Workbook();
  // exceljs typings accept Buffer / Uint8Array
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('XLSX_EMPTY');
  }
  const matrix: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values: string[] = [];
    const len = row.cellCount;
    for (let i = 1; i <= len; i += 1) {
      const cell = row.getCell(i);
      let text = '';
      if (cell.text != null && String(cell.text).trim() !== '') {
        text = String(cell.text).trim();
      } else if (
        typeof cell.value === 'string' ||
        typeof cell.value === 'number'
      ) {
        text = String(cell.value).trim();
      } else if (cell.value != null && typeof cell.value === 'object') {
        const rich = cell.value as { text?: unknown; result?: unknown };
        if (typeof rich.text === 'string') text = rich.text.trim();
        else if (
          typeof rich.result === 'string' ||
          typeof rich.result === 'number'
        ) {
          text = String(rich.result).trim();
        }
      }
      values.push(text);
    }
    if (values.some((v) => v !== '')) matrix.push(values);
  });
  return toTabular(OUTBOUND_IMPORT_KINDS.XLSX, matrix);
}

export function parsePasteTable(input: {
  headers?: string[];
  rows: string[][];
  /** Raw TSV/CSV text pasted by user */
  text?: string;
}): TabularParseResult {
  if (input.text && input.text.trim()) {
    const delimiter = input.text.includes('\t')
      ? '\t'
      : detectDelimiter(input.text);
    const matrix = parseDelimited(input.text, delimiter);
    return toTabular(OUTBOUND_IMPORT_KINDS.PASTE, matrix);
  }
  const headers =
    input.headers && input.headers.length > 0
      ? input.headers.map((h) => String(h ?? '').trim())
      : [];
  const rows = (input.rows ?? []).map((r) =>
    r.map((c) => String(c ?? '').trim()),
  );
  if (headers.length === 0 && rows.length > 0) {
    // First row as headers
    return toTabular(OUTBOUND_IMPORT_KINDS.PASTE, [rows[0], ...rows.slice(1)]);
  }
  return toTabular(OUTBOUND_IMPORT_KINDS.PASTE, [headers, ...rows]);
}

function toTabular(
  kind: OutboundImportKind,
  matrix: string[][],
): TabularParseResult {
  if (matrix.length === 0) {
    throw new Error('TABULAR_EMPTY');
  }
  const headers = matrix[0].map((h, i) => {
    const t = String(h ?? '').trim();
    return t || `col_${i + 1}`;
  });
  const width = headers.length;
  const rows = matrix.slice(1).map((r) => {
    const cells = [...r.map((c) => String(c ?? '').trim())];
    while (cells.length < width) cells.push('');
    return cells.slice(0, width);
  });
  const nonEmpty = rows.filter((r) => r.some((c) => c !== ''));
  if (nonEmpty.length > OUTBOUND_IMPORT_MAX_ROWS) {
    throw new Error('TABULAR_TOO_MANY_ROWS');
  }
  return { kind, headers, rows: nonEmpty };
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    // skip trailing empty line
    if (row.length === 1 && row[0] === '' && rows.length > 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      continue;
    }
    if (ch === '\n') {
      pushField();
      pushRow();
      continue;
    }
    if (ch === '\r') continue;
    field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}
