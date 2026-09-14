import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSearchUrl,
  createCustomEngine,
  cycleSearchEngine,
  deriveShortLabel,
  getSearchEngine,
  isBuiltinSearchEngineId,
  isSearchEngineId,
  isValidEngineTemplate,
  listSearchEngines,
  MAX_CUSTOM_ENGINES,
  NAV_CUSTOM_ENGINES_STORAGE_KEY,
  parseCustomEngines,
  readCustomEngines,
  readPreferredEngine,
  SEARCH_ENGINES,
  type SearchEngine,
  validateEngineDraft,
  writeCustomEngines,
  writePreferredEngine,
} from "@/modules/navigation/searchEngines";

const custom = (id: string, label = id, urlTemplate = `https://example.test/?q={q}`): SearchEngine => ({
  id,
  label,
  shortLabel: deriveShortLabel(label),
  urlTemplate,
  custom: true,
});

beforeEach(() => {
  localStorage.clear();
});

describe("searchEngines built-ins", () => {
  it("exposes Google, Bing and Baidu", () => {
    expect(SEARCH_ENGINES.map((engine) => engine.id)).toEqual(["google", "bing", "baidu"]);
  });

  it("builds encoded search URLs", () => {
    expect(buildSearchUrl(getSearchEngine("google"), "hello world")).toBe("https://www.google.com/search?q=hello%20world");
    expect(buildSearchUrl(getSearchEngine("bing"), "你好")).toBe("https://www.bing.com/search?q=%E4%BD%A0%E5%A5%BD");
    expect(buildSearchUrl(getSearchEngine("baidu"), "memos")).toBe("https://www.baidu.com/s?wd=memos");
  });

  it("returns an empty URL for a blank query", () => {
    expect(buildSearchUrl(getSearchEngine("google"), "   ")).toBe("");
  });

  it("replaces every {q} occurrence in a template", () => {
    const engine = custom("multi", "Multi", "https://example.test/s?q={q}&hl=en&again={q}");
    expect(buildSearchUrl(engine, "a b")).toBe("https://example.test/s?q=a%20b&hl=en&again=a%20b");
  });

  it("cycles engines forward and wraps", () => {
    expect(cycleSearchEngine("google", 1).id).toBe("bing");
    expect(cycleSearchEngine("bing", 1).id).toBe("baidu");
    expect(cycleSearchEngine("baidu", 1).id).toBe("google");
  });

  it("cycles engines backward", () => {
    expect(cycleSearchEngine("google", -1).id).toBe("baidu");
    expect(cycleSearchEngine("baidu", -1).id).toBe("bing");
  });

  it("validates engine ids", () => {
    expect(isBuiltinSearchEngineId("google")).toBe(true);
    expect(isBuiltinSearchEngineId("yahoo")).toBe(false);
    expect(isBuiltinSearchEngineId(null)).toBe(false);
    expect(isSearchEngineId("google")).toBe(true);
    expect(isSearchEngineId("custom-abc", [custom("custom-abc")])).toBe(true);
    expect(isSearchEngineId("custom-abc")).toBe(false);
    expect(isSearchEngineId(null)).toBe(false);
  });
});

describe("searchEngines custom validation", () => {
  it("accepts http(s) templates that contain {q}", () => {
    expect(isValidEngineTemplate("https://duckduckgo.com/?q={q}")).toBe(true);
    expect(isValidEngineTemplate("http://localhost:8080/search?query={q}")).toBe(true);
  });

  it("rejects non-http templates and templates without {q}", () => {
    expect(isValidEngineTemplate("javascript:alert(1)")).toBe(false);
    expect(isValidEngineTemplate("https://example.test/search")).toBe(false);
    expect(isValidEngineTemplate("ftp://example.test/?q={q}")).toBe(false);
  });

  it("reports draft errors in priority order", () => {
    expect(validateEngineDraft({ label: "  ", urlTemplate: "https://e.test/?q={q}" })).toBe("labelRequired");
    expect(validateEngineDraft({ label: "E", urlTemplate: "" })).toBe("urlInvalid");
    expect(validateEngineDraft({ label: "E", urlTemplate: "example.test/?q={q}" })).toBe("urlInvalid");
    expect(validateEngineDraft({ label: "E", urlTemplate: "https://example.test/search" })).toBe("missingQueryPlaceholder");
    expect(validateEngineDraft({ label: "E", urlTemplate: "https://example.test/?q={q}" })).toBe(null);
  });

  it("caps the number of custom engines", () => {
    expect(validateEngineDraft({ label: "E", urlTemplate: "https://e.test/?q={q}" }, MAX_CUSTOM_ENGINES)).toBe("tooManyEngines");
  });

  it("derives short labels from latin and CJK names", () => {
    expect(deriveShortLabel("github")).toBe("G");
    expect(deriveShortLabel("  搜狗 ")).toBe("搜");
    expect(deriveShortLabel("")).toBe("?");
  });
});

describe("searchEngines custom lifecycle", () => {
  it("creates a custom engine with a generated id and short label", () => {
    const engine = createCustomEngine({ label: "DuckDuckGo", urlTemplate: "https://duckduckgo.com/?q={q}" });
    expect(engine.id.startsWith("custom-")).toBe(true);
    expect(engine.label).toBe("DuckDuckGo");
    expect(engine.shortLabel).toBe("D");
    expect(engine.custom).toBe(true);
    expect(engine.urlTemplate).toBe("https://duckduckgo.com/?q={q}");
  });

  it("throws when the draft is invalid", () => {
    expect(() => createCustomEngine({ label: "", urlTemplate: "https://e.test/?q={q}" })).toThrow("labelRequired");
  });

  it("cycles through built-in and custom engines together", () => {
    const extra = [custom("custom-ddg", "DDG")];
    expect(listSearchEngines(extra).map((engine) => engine.id)).toEqual(["google", "bing", "baidu", "custom-ddg"]);
    expect(cycleSearchEngine("baidu", 1, extra).id).toBe("custom-ddg");
    expect(cycleSearchEngine("custom-ddg", 1, extra).id).toBe("google");
    expect(cycleSearchEngine("custom-ddg", -1, extra).id).toBe("baidu");
  });

  it("falls back to Google for an unknown id", () => {
    expect(getSearchEngine("missing", [custom("custom-ddg")]).id).toBe("google");
    expect(getSearchEngine("custom-ddg", [custom("custom-ddg")]).id).toBe("custom-ddg");
  });

  it("builds search URLs for custom engines", () => {
    const engine = custom("custom-ddg", "DDG", "https://duckduckgo.com/?q={q}&ia=web");
    expect(buildSearchUrl(engine, "memos note")).toBe("https://duckduckgo.com/?q=memos%20note&ia=web");
  });
});

describe("searchEngines custom persistence", () => {
  it("round-trips the custom list through localStorage", () => {
    const engine = createCustomEngine({ label: "DuckDuckGo", urlTemplate: "https://duckduckgo.com/?q={q}" });
    writeCustomEngines([engine]);
    expect(localStorage.getItem(NAV_CUSTOM_ENGINES_STORAGE_KEY)).toContain("duckduckgo");
    expect(readCustomEngines()).toEqual([engine]);
  });

  it("drops invalid, built-in-shadowing and non-array payloads", () => {
    expect(parseCustomEngines("not json")).toEqual([]);
    expect(parseCustomEngines('{"a":1}')).toEqual([]);
    const mixed = JSON.stringify([
      { id: "custom-ok", label: "OK", shortLabel: "O", urlTemplate: "https://ok.test/?q={q}" },
      { id: "custom-bad", label: "", urlTemplate: "https://bad.test/?q={q}" },
      { id: "google", label: "Evil", shortLabel: "E", urlTemplate: "https://evil.test/?q={q}" },
      { id: "custom-noq", label: "NoQ", shortLabel: "N", urlTemplate: "https://noq.test/" },
      "nope",
    ]);
    const parsed = parseCustomEngines(mixed);
    expect(parsed.map((engine) => engine.id)).toEqual(["custom-ok"]);
    expect(parsed[0].custom).toBe(true);
  });

  it("fills in id and shortLabel when the stored record is thin", () => {
    const parsed = parseCustomEngines(JSON.stringify([{ label: "Scratch", urlTemplate: "https://scratch.test/?q={q}" }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id.startsWith("custom-")).toBe(true);
    expect(parsed[0].shortLabel).toBe("S");
  });

  it("returns an empty list when localStorage is unreadable", () => {
    expect(readCustomEngines()).toEqual([]);
  });

  it("persists the preferred engine id, including custom ones", () => {
    writePreferredEngine("custom-ddg");
    expect(readPreferredEngine()).toBe("custom-ddg");
    expect(readPreferredEngine()).not.toBe("");
  });
});
