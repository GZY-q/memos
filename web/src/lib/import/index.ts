import { parseMemoCsv } from "./csv";
import { parseFlomoJson } from "./flomo";
import { isMarkdownPath, parseMarkdownFiles } from "./markdown";
import { ImportError, type ParseResult } from "./types";
import { readZipEntries } from "./zip";

export { parseMemoCsv } from "./csv";
export { parseFlomoJson } from "./flomo";
export { parseMarkdownFiles } from "./markdown";
export type { ImportedMemo, ParseResult } from "./types";
export { ImportError } from "./types";
export { readZipEntries } from "./zip";

const decoder = new TextDecoder("utf-8");

const looksLikeFlomoJson = (text: string): boolean => {
  const head = text.trimStart().slice(0, 200).toLowerCase();
  return head.startsWith("{") || head.startsWith("[");
};

/**
 * Detect and parse an import file by extension / content.
 * Supported: Flomo JSON, CSV, Obsidian markdown, and zip archives of those.
 */
export const parseImportFile = async (file: File): Promise<ParseResult> => {
  const name = file.name.toLowerCase();

  if (name.endsWith(".zip")) {
    const entries = await readZipEntries(await file.arrayBuffer());
    const markdownFiles = entries
      .filter((entry) => isMarkdownPath(entry.path))
      .map((entry) => ({ path: entry.path, text: decoder.decode(entry.bytes) }));
    if (markdownFiles.length > 0) {
      return parseMarkdownFiles(markdownFiles);
    }
    // Flomo sometimes ships memos.json inside a zip.
    const jsonEntry = entries.find((entry) => entry.path.toLowerCase().endsWith(".json"));
    if (jsonEntry) {
      return parseFlomoJson(decoder.decode(jsonEntry.bytes));
    }
    throw new ImportError("Zip archive contains no markdown or Flomo JSON files.");
  }

  if (name.endsWith(".md")) {
    return parseMarkdownFiles([{ path: file.name, text: await file.text(), lastModified: file.lastModified }]);
  }

  const text = await file.text();
  if (name.endsWith(".csv")) {
    return parseMemoCsv(text);
  }
  if (name.endsWith(".json") || looksLikeFlomoJson(text)) {
    return parseFlomoJson(text);
  }
  if (isMarkdownPath(name) || text.trimStart().startsWith("#")) {
    return parseMarkdownFiles([{ path: file.name, text, lastModified: file.lastModified }]);
  }
  throw new ImportError("Unsupported file type. Use Flomo JSON, CSV, Markdown, or a zip of markdown files.");
};
