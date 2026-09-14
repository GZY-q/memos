/**
 * Chrome / Firefox Netscape bookmark HTML import.
 *
 * Pure parser + merge helpers. The browser export is untrusted text: every
 * URL is validated, titles are truncated, and duplicate URLs (already on the
 * wall) are skipped so one click never forks the same card twice.
 */

import type { NavCard, NavConfig, NavGroup } from "./types";
import { isValidHttpUrl } from "./validate";

export interface ParsedBookmarkItem {
  title: string;
  url: string;
}

export interface ParsedBookmarkFolder {
  name: string;
  items: ParsedBookmarkItem[];
}

export interface BookmarkImportSummary {
  config: NavConfig;
  addedGroups: number;
  addedCards: number;
  skippedDuplicates: number;
}

/** Chrome wrapper folders whose children are the real top-level groups. */
const ROOT_WRAPPER_NAMES = new Set(
  [
    "bookmarks bar",
    "bookmarks toolbar",
    "other bookmarks",
    "mobile bookmarks",
    "bookmarks menu",
    "书签栏",
    "书签工具栏",
    "其他书签",
    "移动设备书签",
    "书签菜单",
  ].map((name) => name.toLowerCase()),
);

const TITLE_MAX = 200;
const URL_MAX = 2048;
const GROUP_MAX = 100;

const newId = (prefix: "c" | "g"): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const normalizeTitle = (value: string, fallback: string): string => {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return (trimmed || fallback).slice(0, TITLE_MAX);
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * Parses a Netscape bookmark file into flat folders.
 *
 * Top-level Chrome wrappers (「书签栏」「其他书签」) are skipped so their
 * children become real groups. Nested folders keep hierarchy as
 * `Parent / Child`. Loose bookmarks under the root land in `rootFolderName`.
 */
export const parseBookmarkHtml = (html: string, rootFolderName = "书签导入"): ParsedBookmarkFolder[] => {
  const folders: ParsedBookmarkFolder[] = [];
  const byName = new Map<string, ParsedBookmarkFolder>();

  const pushItem = (folderName: string, item: ParsedBookmarkItem) => {
    let folder = byName.get(folderName);
    if (!folder) {
      folder = { name: folderName, items: [] };
      byName.set(folderName, folder);
      folders.push(folder);
    }
    folder.items.push(item);
  };

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [];
  }

  const rootDl = doc.querySelector("dl");
  if (!rootDl) return [];

  /**
   * Chrome nests each subfolder's <DL> inside the parent <DT> (unclosed DT),
   * so walk children of a DL, not sibling DT/DL pairs.
   */
  const walk = (dl: Element, path: string[], isRoot: boolean) => {
    const direct: ParsedBookmarkItem[] = [];

    for (const dt of Array.from(dl.children)) {
      if (dt.tagName !== "DT") continue;
      const heading = Array.from(dt.children).find((child) => child.tagName === "H3");
      const anchor = Array.from(dt.children).find((child) => child.tagName === "A");
      let nested = Array.from(dt.children).find((child) => child.tagName === "DL");
      // Some exporters close </DT> and put the folder body as the next sibling.
      if (!nested && heading) {
        let next = dt.nextElementSibling;
        while (next && next.tagName !== "DL") next = next.nextElementSibling;
        nested = next;
      }

      if (heading && nested) {
        const name = (heading.textContent ?? "").replace(/\s+/g, " ").trim() || "未命名";
        // Unwrap Chrome's root folders so 「书签栏/开发」 becomes just 「开发」.
        if (isRoot && ROOT_WRAPPER_NAMES.has(name.toLowerCase())) {
          walk(nested, [], false);
        } else {
          walk(nested, [...path, name], false);
        }
        continue;
      }

      if (!anchor) continue;
      const href = (anchor.getAttribute("href") ?? "").trim();
      if (!isValidHttpUrl(href)) continue;
      const url = href.slice(0, URL_MAX);
      direct.push({ title: normalizeTitle(anchor.textContent ?? "", hostOf(url)), url });
    }

    if (direct.length > 0) {
      const folderName = (isRoot ? rootFolderName : path.join(" / ") || rootFolderName).slice(0, GROUP_MAX);
      for (const item of direct) pushItem(folderName, item);
    }
  };

  walk(rootDl, [], true);

  return folders
    .filter((folder) => folder.items.length > 0)
    .map((folder) => ({ name: folder.name, items: folder.items.map((item) => ({ ...item })) }));
};

/**
 * Merges parsed folders into the existing wall. Groups match by name so a
 * re-import appends into the same card; URLs already present anywhere are
 * skipped. A newly created group that ends up with zero cards is dropped.
 */
export const importBookmarkFolders = (config: NavConfig, folders: ParsedBookmarkFolder[], now = Date.now()): BookmarkImportSummary => {
  const existingUrls = new Set(config.groups.flatMap((group) => group.items.map((card) => card.url.toLowerCase())));
  let groups: NavGroup[] = config.groups.map((group) => ({ ...group, items: [...group.items] }));
  let addedGroups = 0;
  let addedCards = 0;
  let skippedDuplicates = 0;
  const createdGroupIds = new Set<string>();

  for (const folder of folders) {
    let target = groups.find((group) => group.name === folder.name);
    if (!target) {
      target = { id: newId("g"), name: folder.name.slice(0, GROUP_MAX), collapsed: false, items: [] };
      groups = [...groups, target];
      createdGroupIds.add(target.id);
      addedGroups += 1;
    }

    const additions: NavCard[] = [];
    for (const item of folder.items) {
      const key = item.url.toLowerCase();
      if (existingUrls.has(key)) {
        skippedDuplicates += 1;
        continue;
      }
      existingUrls.add(key);
      additions.push({
        id: newId("c"),
        title: item.title.slice(0, TITLE_MAX),
        url: item.url.slice(0, URL_MAX),
        updatedAt: now,
      });
      addedCards += 1;
    }

    if (additions.length > 0) {
      const groupId = target.id;
      groups = groups.map((group) => (group.id === groupId ? { ...group, items: [...group.items, ...additions] } : group));
    }
  }

  // Drop groups we just created that collected no new cards (all duplicates).
  const keptCreated = groups.filter((group) => createdGroupIds.has(group.id) && group.items.length > 0);
  groups = groups.filter((group) => !(createdGroupIds.has(group.id) && group.items.length === 0));
  addedGroups = keptCreated.length;

  return {
    config: { ...config, groups },
    addedGroups,
    addedCards,
    skippedDuplicates,
  };
};
