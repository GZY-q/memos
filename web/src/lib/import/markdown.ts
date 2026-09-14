import { ImportError, type ImportedMemo, type ParseResult } from "./types";

const FRONTMATTER_DATE_KEYS = ["created", "created_at", "date", "created_time"];

/** Parse a simple YAML frontmatter block for a created date. */
const parseFrontmatterDate = (block: string): Date | undefined => {
  for (const line of block.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line.trim());
    if (!match) continue;
    const key = match[1].toLowerCase();
    if (!FRONTMATTER_DATE_KEYS.includes(key)) continue;
    const raw = match[2].trim().replace(/^["']|["']$/g, "");
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(raw) ? raw.replace(" ", "T") : raw;
    const date = new Date(normalized);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return undefined;
};

/** Split Obsidian-style frontmatter from the body. */
export const splitFrontmatter = (text: string): { created?: Date; body: string } => {
  if (!text.startsWith("---")) return { body: text };
  const end = text.indexOf("\n---", 3);
  if (end < 0) return { body: text };
  const block = text.slice(3, end).replace(/^\r?\n/, "");
  const body = text
    .slice(end + 4)
    .replace(/^[^\n]*\r?\n?/, "")
    .replace(/^\r?\n/, "");
  return { created: parseFrontmatterDate(block), body };
};

export interface MarkdownFileInput {
  /** Relative path inside the vault. */
  path: string;
  text: string;
  /** File mtime as a last-resort creation time (e.g. from a folder picker). */
  lastModified?: number;
}

/**
 * Parse Obsidian (or any) markdown notes. Each non-empty `.md` file becomes one memo.
 * Frontmatter `created`/`date` wins, then filename date, then file lastModified.
 */
export const parseMarkdownFiles = (files: MarkdownFileInput[]): ParseResult => {
  const warnings: string[] = [];
  const memos: ImportedMemo[] = [];

  for (const file of files) {
    if (!file.path.toLowerCase().endsWith(".md")) continue;
    const { created, body } = splitFrontmatter(file.text);
    const content = body.trim();
    if (!content) {
      warnings.push(`${file.path} is empty`);
      continue;
    }

    const nameDateMatch = /(\d{4}-\d{2}-\d{2})/.exec(file.path);
    const nameDate = nameDateMatch ? new Date(`${nameDateMatch[1]}T12:00:00`) : undefined;
    const fallback = nameDate && !Number.isNaN(nameDate.getTime()) ? nameDate : undefined;

    memos.push({
      content,
      createTime: created ?? fallback ?? (file.lastModified ? new Date(file.lastModified) : undefined),
      source: file.path,
    });
  }

  if (memos.length === 0) {
    throw new ImportError("No non-empty markdown files found.");
  }
  return { memos, warnings };
};

export const isMarkdownPath = (path: string): boolean => path.toLowerCase().endsWith(".md");
