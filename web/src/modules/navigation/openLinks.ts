/**
 * Opens every URL in a navigation group as a new tab.
 *
 * Browsers only honor `window.open` inside a user gesture, and they throttle
 * bursts of popups. Open sequentially with a short delay so the first tab is
 * still "caused" by the click, and report how many were blocked so the UI can
 * say so honestly.
 */

/** Above this count, require an explicit confirm before opening. */
export const OPEN_ALL_CONFIRM_THRESHOLD = 12;

/** Hard ceiling so one click cannot spawn an unbounded tab storm. */
export const OPEN_ALL_MAX = 40;

const TAB_OPEN_DELAY_MS = 70;

export type OpenAllResult = { opened: number; blocked: number; skipped: number };

export type TabOpener = (url: string) => unknown;

export const defaultTabOpener: TabOpener = (url) => window.open(url, "_blank", "noopener,noreferrer");

export const openUrlsInTabs = async (
  urls: string[],
  open: TabOpener = defaultTabOpener,
  delayMs = TAB_OPEN_DELAY_MS,
): Promise<OpenAllResult> => {
  let opened = 0;
  let blocked = 0;
  let skipped = 0;

  for (const raw of urls) {
    const url = raw.trim();
    if (!/^https?:\/\//i.test(url)) {
      skipped += 1;
      continue;
    }
    let handle: unknown = null;
    try {
      handle = open(url);
    } catch {
      handle = null;
    }
    // `window.open` returns null when blocked (or a Window that is immediately closed).
    if (handle) opened += 1;
    else blocked += 1;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return { opened, blocked, skipped };
};

export const collectGroupUrls = (items: Array<{ url: string }>, limit = OPEN_ALL_MAX): string[] =>
  items.slice(0, limit).map((item) => item.url);
