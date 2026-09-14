/** A memo ready to be created by the import pipeline. */
export interface ImportedMemo {
  /** Markdown body. */
  content: string;
  /** Source creation time when the export carried one. */
  createTime?: Date;
  /** Source label used in error messages (filename, row number, …). */
  source: string;
}

export interface ParseResult {
  memos: ImportedMemo[];
  /** Non-fatal notes about skipped rows/files. */
  warnings: string[];
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}
