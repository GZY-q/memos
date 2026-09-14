/**
 * Web search engines wired into the navigation spotlight bar.
 *
 * Pure and dependency-free: Tab cycles the active engine, Enter opens the
 * selected engine's results for the current query. Preferred engine is
 * persisted in localStorage so the last choice survives a reload.
 */

export type SearchEngineId = "google" | "bing" | "baidu";

export interface SearchEngine {
  id: SearchEngineId;
  label: string;
  /** Compact chip glyph — one or two characters, no branding assets. */
  shortLabel: string;
  /** URL template with a `{q}` placeholder (already encoded at build time). */
  urlTemplate: string;
}

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: "google", label: "Google", shortLabel: "G", urlTemplate: "https://www.google.com/search?q={q}" },
  { id: "bing", label: "Bing", shortLabel: "B", urlTemplate: "https://www.bing.com/search?q={q}" },
  { id: "baidu", label: "百度", shortLabel: "百", urlTemplate: "https://www.baidu.com/s?wd={q}" },
] as const;

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = "google";

export const NAV_ENGINE_STORAGE_KEY = "nav-search-engine";

export const isSearchEngineId = (value: string | null | undefined): value is SearchEngineId =>
  value === "google" || value === "bing" || value === "baidu";

export const getSearchEngine = (id: SearchEngineId): SearchEngine => SEARCH_ENGINES.find((engine) => engine.id === id) ?? SEARCH_ENGINES[0];

export const buildSearchUrl = (engine: SearchEngine, query: string): string => {
  const trimmed = query.trim();
  if (!trimmed) return "";
  return engine.urlTemplate.replace("{q}", encodeURIComponent(trimmed));
};

/** Cycles forward (`delta = 1`) or backward (`delta = -1`) through the engine list. */
export const cycleSearchEngine = (current: SearchEngineId, delta: number): SearchEngine => {
  const index = SEARCH_ENGINES.findIndex((engine) => engine.id === current);
  const from = index < 0 ? 0 : index;
  const length = SEARCH_ENGINES.length;
  const next = (((from + delta) % length) + length) % length;
  return SEARCH_ENGINES[next];
};

export const readPreferredEngine = (): SearchEngineId => {
  try {
    const saved = localStorage.getItem(NAV_ENGINE_STORAGE_KEY);
    return isSearchEngineId(saved) ? saved : DEFAULT_SEARCH_ENGINE;
  } catch {
    return DEFAULT_SEARCH_ENGINE;
  }
};

export const writePreferredEngine = (id: SearchEngineId): void => {
  try {
    localStorage.setItem(NAV_ENGINE_STORAGE_KEY, id);
  } catch {
    // Private mode / quota — preference is best-effort.
  }
};
