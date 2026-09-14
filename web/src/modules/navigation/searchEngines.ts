/**
 * Web search engines wired into the navigation spotlight bar.
 *
 * Pure and dependency-free: Tab cycles the active engine, Enter opens the
 * selected engine's results for the current query. Built-in engines ship in
 * code; user-defined engines (label + `{q}` URL template) live in localStorage
 * and append to the cycle. Preferred engine is persisted too so the last
 * choice survives a reload.
 */

/** Any engine id — the three built-ins plus user-defined `custom-*` ids. */
export type SearchEngineId = string;

export type BuiltinSearchEngineId = "google" | "bing" | "baidu";

export interface SearchEngine {
  id: SearchEngineId;
  label: string;
  /** Compact chip glyph — one or two characters, no branding assets. */
  shortLabel: string;
  /** URL template with a `{q}` placeholder (already encoded at build time). */
  urlTemplate: string;
  /** True for engines the user added; they can also be removed. */
  custom?: boolean;
}

export const SEARCH_ENGINES: readonly SearchEngine[] = [
  { id: "google", label: "Google", shortLabel: "G", urlTemplate: "https://www.google.com/search?q={q}" },
  { id: "bing", label: "Bing", shortLabel: "B", urlTemplate: "https://www.bing.com/search?q={q}" },
  { id: "baidu", label: "百度", shortLabel: "百", urlTemplate: "https://www.baidu.com/s?wd={q}" },
] as const;

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = "google";

export const NAV_ENGINE_STORAGE_KEY = "nav-search-engine";

export const NAV_CUSTOM_ENGINES_STORAGE_KEY = "nav-custom-search-engines";

/** Hard cap so a runaway list cannot bloat the spotlight chips or localStorage. */
export const MAX_CUSTOM_ENGINES = 8;

const MAX_LABEL_LENGTH = 40;
const MAX_TEMPLATE_LENGTH = 2048;

export type EngineDraftError = "labelRequired" | "urlInvalid" | "missingQueryPlaceholder" | "tooManyEngines";

export interface EngineDraft {
  label: string;
  urlTemplate: string;
}

export const isBuiltinSearchEngineId = (value: string | null | undefined): value is BuiltinSearchEngineId =>
  value === "google" || value === "bing" || value === "baidu";

export const listSearchEngines = (custom: readonly SearchEngine[] = []): SearchEngine[] => [...SEARCH_ENGINES, ...custom];

export const isSearchEngineId = (value: string | null | undefined, custom: readonly SearchEngine[] = []): boolean =>
  typeof value === "string" && value !== "" && listSearchEngines(custom).some((engine) => engine.id === value);

/** http(s) URL that still carries the `{q}` placeholder. */
export const isValidEngineTemplate = (value: string): boolean => {
  const trimmed = value.trim();
  if (!/\{q\}/.test(trimmed)) return false;
  // The template is not a valid URL while `{q}` is unresolved; substitute a probe.
  const probe = trimmed.replaceAll("{q}", "probe");
  try {
    const parsed = new URL(probe);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const validateEngineDraft = (draft: EngineDraft, customCount = 0): EngineDraftError | null => {
  if (!draft.label.trim()) return "labelRequired";
  if (!draft.urlTemplate.trim()) return "urlInvalid";
  if (!/^https?:\/\//i.test(draft.urlTemplate.trim())) return "urlInvalid";
  if (!isValidEngineTemplate(draft.urlTemplate)) return "missingQueryPlaceholder";
  if (customCount >= MAX_CUSTOM_ENGINES) return "tooManyEngines";
  return null;
};

/** One- or two-character chip glyph derived from a user-supplied label. */
export const deriveShortLabel = (label: string): string => {
  const trimmed = label.trim();
  if (!trimmed) return "?";
  const first = trimmed[0];
  // CJK glyphs are already wide; take a single character.
  if (/[\u2e80-\u9fff\uff00-\uffef]/.test(first)) return first.slice(0, 1);
  return first.toUpperCase();
};

const newCustomEngineId = (): SearchEngineId => `custom-${Math.random().toString(36).slice(2, 10)}`;

/** Builds a persisted custom engine from a validated draft. Throws on invalid input. */
export const createCustomEngine = (draft: EngineDraft, existing: readonly SearchEngine[] = []): SearchEngine => {
  const problem = validateEngineDraft(draft, existing.filter((engine) => engine.custom).length);
  if (problem) throw new Error(problem);
  const label = draft.label.trim().slice(0, MAX_LABEL_LENGTH);
  return {
    id: newCustomEngineId(),
    label,
    shortLabel: deriveShortLabel(label),
    urlTemplate: draft.urlTemplate.trim().slice(0, MAX_TEMPLATE_LENGTH),
    custom: true,
  };
};

/** Sanitizes one untrusted record into a custom engine, or null when unusable. */
export const parseCustomEngine = (value: unknown): SearchEngine | null => {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const label = typeof record.label === "string" ? record.label.trim().slice(0, MAX_LABEL_LENGTH) : "";
  const urlTemplate = typeof record.urlTemplate === "string" ? record.urlTemplate.trim().slice(0, MAX_TEMPLATE_LENGTH) : "";
  if (!label || !isValidEngineTemplate(urlTemplate)) return null;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : newCustomEngineId();
  // Never let a custom entry shadow a built-in id — the cycle would list it twice.
  if (isBuiltinSearchEngineId(id)) return null;
  const shortLabel =
    typeof record.shortLabel === "string" && record.shortLabel.trim() ? record.shortLabel.trim().slice(0, 2) : deriveShortLabel(label);
  return { id, label, shortLabel, urlTemplate, custom: true };
};

/** Parses a stored JSON array of custom engines; drops every invalid entry. */
export const parseCustomEngines = (raw: string): SearchEngine[] => {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data
    .map(parseCustomEngine)
    .filter((engine): engine is SearchEngine => engine !== null)
    .slice(0, MAX_CUSTOM_ENGINES);
};

export const readCustomEngines = (): SearchEngine[] => {
  try {
    const raw = localStorage.getItem(NAV_CUSTOM_ENGINES_STORAGE_KEY);
    return raw ? parseCustomEngines(raw) : [];
  } catch {
    return [];
  }
};

export const writeCustomEngines = (engines: readonly SearchEngine[]): void => {
  try {
    localStorage.setItem(NAV_CUSTOM_ENGINES_STORAGE_KEY, JSON.stringify(engines));
  } catch {
    // Private mode / quota — list stays in memory for this session.
  }
};

export const getSearchEngine = (id: SearchEngineId, custom: readonly SearchEngine[] = []): SearchEngine =>
  listSearchEngines(custom).find((engine) => engine.id === id) ?? SEARCH_ENGINES[0];

export const buildSearchUrl = (engine: SearchEngine, query: string): string => {
  const trimmed = query.trim();
  if (!trimmed) return "";
  return engine.urlTemplate.replaceAll("{q}", encodeURIComponent(trimmed));
};

/** Cycles forward (`delta = 1`) or backward (`delta = -1`) through the engine list. */
export const cycleSearchEngine = (current: SearchEngineId, delta: number, custom: readonly SearchEngine[] = []): SearchEngine => {
  const engines = listSearchEngines(custom);
  const index = engines.findIndex((engine) => engine.id === current);
  const from = index < 0 ? 0 : index;
  const length = engines.length;
  const next = (((from + delta) % length) + length) % length;
  return engines[next];
};

export const readPreferredEngine = (): SearchEngineId => {
  try {
    const saved = localStorage.getItem(NAV_ENGINE_STORAGE_KEY);
    return saved || DEFAULT_SEARCH_ENGINE;
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
