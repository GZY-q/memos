import { ImportError, type ImportedMemo, type ParseResult } from "./types";

/** Split one CSV line respecting double-quoted fields (RFC 4180 subset). */
const splitCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
};

const parseCsvTime = (value: string | undefined): Date | undefined => {
  if (!value) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(" ", "T") : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const pickColumn = (headers: string[], row: string[], candidates: string[]): string | undefined => {
  for (const name of candidates) {
    const index = headers.indexOf(name);
    if (index >= 0 && row[index]) return row[index];
  }
  return undefined;
};

/**
 * Parse a CSV export. Expected columns (case-insensitive, flexible aliases):
 * content (or text/memo) and optional created_at (or created/date/time).
 */
export const parseMemoCsv = (text: string): ParseResult => {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new ImportError("CSV needs a header row and at least one data row.");
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.toLowerCase());
  const contentColumn = headers.findIndex((header) => ["content", "text", "memo", "body"].includes(header));
  if (contentColumn < 0) {
    throw new ImportError("CSV must include a content column.");
  }

  const warnings: string[] = [];
  const memos: ImportedMemo[] = [];

  for (let index = 1; index < lines.length; index += 1) {
    const row = splitCsvLine(lines[index]);
    const content = (row[contentColumn] ?? "").trim();
    if (!content) {
      warnings.push(`Row ${index + 1} is empty`);
      continue;
    }
    memos.push({
      content,
      createTime: parseCsvTime(pickColumn(headers, row, ["created_at", "created", "createdat", "date", "time", "created_time"])),
      source: `CSV row ${index + 1}`,
    });
  }

  if (memos.length === 0) {
    throw new ImportError("No importable rows found in CSV.");
  }
  return { memos, warnings };
};
