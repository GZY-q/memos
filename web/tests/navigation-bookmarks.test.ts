import { describe, expect, it } from "vitest";
import { importBookmarkFolders, parseBookmarkHtml } from "@/modules/navigation/bookmarks";
import type { NavConfig } from "@/modules/navigation/types";

const chromeExport = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001">书签栏</H3>
    <DL><p>
        <DT><H3>开发</H3>
        <DL><p>
            <DT><A HREF="https://github.com" ADD_DATE="1">GitHub</A>
            <DT><A HREF="https://developer.mozilla.org" ADD_DATE="2">MDN</A>
            <DT><A HREF="javascript:void(0)">Bad</A>
        </DL><p>
        <DT><A HREF="https://www.usememos.com" ADD_DATE="3">Memos</A>
        <DT><H3>阅读</H3>
        <DL><p>
            <DT><H3>技术</H3>
            <DL><p>
                <DT><A HREF="https://news.ycombinator.com" ADD_DATE="4">HN</A>
            </DL><p>
        </DL><p>
    </DL><p>
    <DT><H3>其他书签</H3>
    <DL><p>
        <DT><A HREF="https://example.com" ADD_DATE="5">Example</A>
    </DL><p>
</DL><p>
`;

const emptyConfig = (): NavConfig => ({
  version: 1,
  rev: 1,
  updatedAt: Date.now(),
  groups: [],
  tombstones: [],
});

describe("parseBookmarkHtml", () => {
  it("unwraps Chrome root folders and maps nested folders to Parent / Child", () => {
    const folders = parseBookmarkHtml(chromeExport);
    const names = folders.map((folder) => folder.name).sort();

    // Unwrapped 书签栏 children: 开发 + nested 阅读/技术;
    // loose items (Memos, Example) land in the root import folder.
    // Intermediate folder 阅读 has no direct links, so it is not created.
    expect(names).toEqual(["书签导入", "开发", "阅读 / 技术"]);

    const dev = folders.find((folder) => folder.name === "开发");
    expect(dev?.items.map((item) => item.title).sort()).toEqual(["GitHub", "MDN"]);

    const root = folders.find((folder) => folder.name === "书签导入");
    expect(root?.items.map((item) => item.title).sort()).toEqual(["Example", "Memos"]);
  });

  it("drops javascript: and other non-http links", () => {
    const folders = parseBookmarkHtml(chromeExport);
    const urls = folders.flatMap((folder) => folder.items.map((item) => item.url));
    expect(urls.every((url) => url.startsWith("http"))).toBe(true);
    expect(urls).not.toContain("javascript:void(0)");
  });

  it("keeps nested hierarchy as Parent / Child", () => {
    const folders = parseBookmarkHtml(chromeExport);
    const nested = folders.find((folder) => folder.items.some((item) => item.url === "https://news.ycombinator.com"));
    expect(nested?.name).toBe("阅读 / 技术");
  });

  it("returns [] for non-bookmark HTML", () => {
    expect(parseBookmarkHtml("<html><body>hello</body></html>")).toEqual([]);
  });
});

describe("importBookmarkFolders", () => {
  it("creates groups from folders and skips duplicate URLs", () => {
    const folders = parseBookmarkHtml(chromeExport);
    const config = emptyConfig();
    const first = importBookmarkFolders(config, folders);

    expect(first.addedCards).toBeGreaterThan(0);
    expect(first.config.groups.length).toBeGreaterThan(0);
    expect(first.skippedDuplicates).toBe(0);

    const second = importBookmarkFolders(first.config, folders);
    expect(second.addedCards).toBe(0);
    expect(second.skippedDuplicates).toBe(first.addedCards);
    expect(second.config.groups).toHaveLength(first.config.groups.length);
  });

  it("appends into an existing group with the same name", () => {
    const base: NavConfig = {
      ...emptyConfig(),
      groups: [
        { id: "g-dev", name: "开发", collapsed: false, items: [{ id: "c-1", title: "Old", url: "https://old.example", updatedAt: 1 }] },
      ],
    };
    const result = importBookmarkFolders(base, [{ name: "开发", items: [{ title: "New", url: "https://new.example" }] }]);

    expect(result.addedGroups).toBe(0);
    expect(result.addedCards).toBe(1);
    const group = result.config.groups.find((g) => g.name === "开发");
    expect(group?.items).toHaveLength(2);
  });
});
