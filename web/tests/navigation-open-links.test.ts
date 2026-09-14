import { describe, expect, it, vi } from "vitest";
import { collectGroupUrls, OPEN_ALL_MAX, openUrlsInTabs } from "@/modules/navigation/openLinks";

describe("collectGroupUrls", () => {
  it("collects urls up to the max", () => {
    const items = Array.from({ length: OPEN_ALL_MAX + 5 }, (_, i) => ({ url: `https://e${i}.com` }));
    expect(collectGroupUrls(items)).toHaveLength(OPEN_ALL_MAX);
    expect(collectGroupUrls([{ url: "https://a.com" }, { url: "https://b.com" }])).toEqual(["https://a.com", "https://b.com"]);
  });
});

describe("openUrlsInTabs", () => {
  it("opens http urls and skips invalid ones", async () => {
    const open = vi.fn((url: string) => (url.includes("blocked") ? null : { url }));
    const result = await openUrlsInTabs(["https://ok.com", "javascript:alert(1)", "https://blocked.com", "ftp://x"], open, 0);

    expect(open).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ opened: 1, blocked: 1, skipped: 2 });
  });

  it("counts every open as blocked when the opener returns null", async () => {
    const open = vi.fn(() => null);
    const result = await openUrlsInTabs(["https://a.com", "https://b.com"], open, 0);
    expect(result).toEqual({ opened: 0, blocked: 2, skipped: 0 });
  });
});
