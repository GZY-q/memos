import { describe, expect, it } from "vitest";
import { buildSearchUrl, cycleSearchEngine, getSearchEngine, isSearchEngineId, SEARCH_ENGINES } from "@/modules/navigation/searchEngines";

describe("searchEngines", () => {
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
    expect(isSearchEngineId("google")).toBe(true);
    expect(isSearchEngineId("yahoo")).toBe(false);
    expect(isSearchEngineId(null)).toBe(false);
  });
});
