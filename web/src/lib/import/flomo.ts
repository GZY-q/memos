import { ImportError, type ImportedMemo, type ParseResult } from "./types";

/** Flomo export memo shape (JSON field names as shipped by flomo). */
interface FlomoMemo {
  content?: string;
  created_at?: string;
  updated_at?: string;
  files?: unknown[];
}

const parseFlomoTime = (value: unknown): Date | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  // Flomo uses "2024-01-01 12:00:00" (local) and sometimes ISO with offset.
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value) ? value.replace(" ", "T") : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const toImportedMemo = (raw: FlomoMemo, index: number): ImportedMemo | string => {
  const content = (raw.content ?? "").trim();
  if (!content) return `Memo ${index + 1} is empty`;
  return {
    content,
    createTime: parseFlomoTime(raw.created_at) ?? parseFlomoTime(raw.updated_at),
    source: `flomo memo ${index + 1}`,
  };
};

/**
 * Parse a Flomo export JSON payload. Accepts:
 * - `{ "memos": [ { content, created_at } ] }` (the common export)
 * - a bare array of memo objects
 * - JSON Lines (one object per line) used by some exporters
 */
export const parseFlomoJson = (text: string): ParseResult => {
  const warnings: string[] = [];
  let rawMemos: FlomoMemo[] = [];

  const trimmed = text.trim();
  if (!trimmed) {
    throw new ImportError("Flomo file is empty.");
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      rawMemos = parsed as FlomoMemo[];
    } else if (parsed && typeof parsed === "object") {
      const container = parsed as { memos?: unknown; data?: unknown };
      const list = Array.isArray(container.memos) ? container.memos : Array.isArray(container.data) ? container.data : undefined;
      if (!list) {
        throw new ImportError("Flomo JSON must contain a memos array.");
      }
      rawMemos = list as FlomoMemo[];
    } else {
      throw new ImportError("Unsupported Flomo JSON shape.");
    }
  } catch (error) {
    if (error instanceof ImportError) throw error;
    // Fall through to JSON Lines.
    rawMemos = trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FlomoMemo);
  }

  const memos: ImportedMemo[] = [];
  rawMemos.forEach((raw, index) => {
    const result = toImportedMemo(raw ?? {}, index);
    if (typeof result === "string") warnings.push(result);
    else memos.push(result);
  });

  if (memos.length === 0) {
    throw new ImportError("No importable memos found in Flomo file.");
  }
  return { memos, warnings };
};
