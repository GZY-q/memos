import { describe, expect, it } from "vitest";
import { buildJournalPath, parseJournalDate } from "@/components/JournalView/paths";
import { getToday } from "@/lib/calendar-utils";
import { parseMemoCsv } from "@/lib/import/csv";
import { parseFlomoJson } from "@/lib/import/flomo";
import { parseMarkdownFiles, splitFrontmatter } from "@/lib/import/markdown";
import { ImportError } from "@/lib/import/types";
import { readZipEntries } from "@/lib/import/zip";

describe("parseFlomoJson", () => {
  it("parses the common { memos: [...] } export", () => {
    const result = parseFlomoJson(
      JSON.stringify({
        memos: [
          { content: "Hello flomo", created_at: "2024-03-01 09:30:00" },
          { content: "  ", created_at: "2024-03-02 09:30:00" },
          { content: "Second note", created_at: "not-a-date" },
        ],
      }),
    );
    expect(result.memos).toHaveLength(2);
    expect(result.memos[0].content).toBe("Hello flomo");
    expect(result.memos[0].createTime).toBeInstanceOf(Date);
    expect(result.memos[0].createTime?.getFullYear()).toBe(2024);
    expect(result.warnings).toHaveLength(1);
  });

  it("parses a bare array export", () => {
    const result = parseFlomoJson(JSON.stringify([{ content: "A" }, { content: "B", created_at: "2024-01-01T00:00:00Z" }]));
    expect(result.memos.map((m) => m.content)).toEqual(["A", "B"]);
  });

  it("parses JSON Lines", () => {
    const result = parseFlomoJson('{"content":"line one","created_at":"2024-05-01 10:00:00"}\n{"content":"line two"}');
    expect(result.memos).toHaveLength(2);
  });

  it("rejects empty payloads", () => {
    expect(() => parseFlomoJson("")).toThrow(ImportError);
    expect(() => parseFlomoJson(JSON.stringify({ memos: [] }))).toThrow(ImportError);
  });
});

describe("parseMemoCsv", () => {
  it("parses content and created_at columns", () => {
    const result = parseMemoCsv('content,created_at\n"Hello, world",2024-06-01 12:00:00\nSecond,2024-06-02\n');
    expect(result.memos).toHaveLength(2);
    expect(result.memos[0].content).toBe("Hello, world");
    expect(result.memos[0].createTime?.getMonth()).toBe(5);
    expect(result.memos[1].createTime?.getDate()).toBe(2);
  });

  it("accepts text/body aliases and skips empty rows", () => {
    const result = parseMemoCsv("text,date\nAlpha,2024-01-01\n,\nBeta,2024-01-02\n");
    expect(result.memos.map((m) => m.content)).toEqual(["Alpha", "Beta"]);
    expect(result.warnings).toHaveLength(1);
  });

  it("requires a content column", () => {
    expect(() => parseMemoCsv("title,body\nnope,also nope\n".replace("body", "note"))).toThrow(ImportError);
  });
});

describe("parseMarkdownFiles", () => {
  it("parses frontmatter dates and skips empty notes", () => {
    const result = parseMarkdownFiles([
      {
        path: "notes/2024-07-04 picnic.md",
        text: "---\ncreated: 2024-07-04 08:00:00\n---\n\n# Picnic\n\nSandwiches.",
      },
      { path: "empty.md", text: "   \n" },
      { path: "plain.md", text: "Just a note." },
    ]);
    expect(result.memos).toHaveLength(2);
    expect(result.memos[0].content).toContain("Sandwiches");
    expect(result.memos[0].createTime?.getDate()).toBe(4);
    expect(result.memos[1].createTime).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
  });

  it("falls back to a date in the filename", () => {
    const result = parseMarkdownFiles([{ path: "daily/2023-12-25.md", text: "Christmas notes" }]);
    expect(result.memos[0].createTime?.getFullYear()).toBe(2023);
  });

  it("splitFrontmatter leaves plain markdown alone", () => {
    expect(splitFrontmatter("# Title\n\nBody").body).toBe("# Title\n\nBody");
  });
});

describe("readZipEntries", () => {
  it("reads stored (uncompressed) zip entries", async () => {
    // Build a minimal stored-method zip with one file: "note.md" → "Hello zip".
    const name = new TextEncoder().encode("note.md");
    const data = new TextEncoder().encode("Hello zip");
    const local = new Uint8Array(30 + name.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, 0, true); // method: stored
    localView.setUint32(18, data.length, true); // compressed
    localView.setUint32(22, data.length, true); // uncompressed
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, 0, true); // local header offset
    central.set(name, 46);

    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);
    eocdView.setUint16(8, 1, true);
    eocdView.setUint16(10, 1, true);
    eocdView.setUint32(12, central.length, true);
    eocdView.setUint32(16, local.length, true);

    const archive = new Uint8Array(local.length + central.length + eocd.length);
    archive.set(local, 0);
    archive.set(central, local.length);
    archive.set(eocd, local.length + central.length);

    const entries = await readZipEntries(archive.buffer);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("note.md");
    expect(new TextDecoder().decode(entries[0].bytes)).toBe("Hello zip");
  });

  it("rejects non-zip buffers", async () => {
    const junk = new TextEncoder().encode("definitely not a zip").buffer;
    await expect(readZipEntries(junk)).rejects.toThrow(ImportError);
  });
});

describe("journal paths", () => {
  it("uses bare /journal for today", () => {
    expect(buildJournalPath(getToday())).toBe("/journal");
    expect(buildJournalPath()).toBe("/journal");
  });

  it("embeds other days in the path", () => {
    expect(buildJournalPath("2024-01-15")).toBe("/journal/2024-01-15");
  });

  it("parses valid dates and rejects junk", () => {
    expect(parseJournalDate(undefined)).toBe(getToday());
    expect(parseJournalDate("2024-02-29")).toBe("2024-02-29");
    expect(parseJournalDate("2024-02-30")).toBeUndefined();
    expect(parseJournalDate("not-a-date")).toBeUndefined();
  });
});
