import { readFileSync, writeFileSync } from 'node:fs';
import { CLAIM_TYPES, type Claim, type ClaimType } from './types.js';

export const CLAIM_COLUMNS = [
  'claim_id',
  'member_id',
  'provider_id',
  'provider_name',
  'claim_date',
  'claim_type',
  'diagnosis_code',
  'procedure_codes',
  'submitted_amount',
  'is_weekend',
] as const satisfies readonly (keyof Claim)[];

export const PROCEDURE_SEPARATOR = '|';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** RFC 4180: quote a field containing a comma, double quote, CR or LF; double any embedded quotes. */
export function escapeField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function formatCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeField).join(',')).join('\r\n') + '\r\n';
}

/** RFC 4180 parser. Accepts CRLF or LF line endings and quoted fields spanning lines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  let line = 1;

  const endField = (): void => {
    row.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        const next = text[i + 1];
        if (next !== undefined && next !== ',' && next !== '\r' && next !== '\n') {
          throw new Error(`CSV line ${line}: unexpected character after closing quote`);
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"') {
      if (field.length > 0) throw new Error(`CSV line ${line}: quote inside unquoted field`);
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      if (ch === '\r' && text[i + 1] === '\n') i++;
      line++;
    } else {
      field += ch;
    }
    i++;
  }
  if (inQuotes) throw new Error(`CSV line ${line}: unterminated quoted field`);
  // A trailing line break ends the last record; it does not start a new one.
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

function claimToRow(claim: Claim): string[] {
  return [
    claim.claim_id,
    claim.member_id,
    claim.provider_id,
    claim.provider_name,
    claim.claim_date,
    claim.claim_type,
    claim.diagnosis_code,
    claim.procedure_codes.join(PROCEDURE_SEPARATOR),
    String(claim.submitted_amount),
    String(claim.is_weekend),
  ];
}

function rowToClaim(row: string[], recordNo: number): Claim {
  const where = `claims CSV record ${recordNo}`;
  if (row.length !== CLAIM_COLUMNS.length) {
    throw new Error(`${where}: expected ${CLAIM_COLUMNS.length} fields, got ${row.length}`);
  }
  const get = (col: (typeof CLAIM_COLUMNS)[number]): string => row[CLAIM_COLUMNS.indexOf(col)] ?? '';

  const claimDate = get('claim_date');
  if (!ISO_DATE.test(claimDate)) throw new Error(`${where}: claim_date must be YYYY-MM-DD, got "${claimDate}"`);

  const claimType = get('claim_type');
  if (!(CLAIM_TYPES as readonly string[]).includes(claimType)) {
    throw new Error(`${where}: claim_type must be one of ${CLAIM_TYPES.join(', ')}, got "${claimType}"`);
  }

  const amountText = get('submitted_amount');
  const amount = Number(amountText);
  if (amountText.trim() === '' || !Number.isFinite(amount)) {
    throw new Error(`${where}: submitted_amount must be a number, got "${amountText}"`);
  }

  const weekendText = get('is_weekend');
  if (weekendText !== 'true' && weekendText !== 'false') {
    throw new Error(`${where}: is_weekend must be "true" or "false", got "${weekendText}"`);
  }

  const codes = get('procedure_codes');
  return {
    claim_id: get('claim_id'),
    member_id: get('member_id'),
    provider_id: get('provider_id'),
    provider_name: get('provider_name'),
    claim_date: claimDate,
    claim_type: claimType as ClaimType,
    diagnosis_code: get('diagnosis_code'),
    procedure_codes: codes === '' ? [] : codes.split(PROCEDURE_SEPARATOR),
    submitted_amount: amount,
    is_weekend: weekendText === 'true',
  };
}

export function claimsToCsv(claims: readonly Claim[]): string {
  return formatCsv([[...CLAIM_COLUMNS], ...claims.map(claimToRow)]);
}

export function claimsFromCsv(text: string): Claim[] {
  const [header, ...records] = parseCsv(text.replace(/^﻿/, ''));
  if (!header || header.join(',') !== CLAIM_COLUMNS.join(',')) {
    throw new Error(`claims CSV header must be: ${CLAIM_COLUMNS.join(',')}`);
  }
  return records.map((row, i) => rowToClaim(row, i + 1));
}

export function readClaims(path: string): Claim[] {
  return claimsFromCsv(readFileSync(path, 'utf8'));
}

export function writeClaims(path: string, claims: readonly Claim[]): void {
  writeFileSync(path, claimsToCsv(claims), 'utf8');
}
