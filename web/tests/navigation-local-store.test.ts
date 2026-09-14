import { beforeEach, describe, expect, it } from "vitest";
import { clearLocalConfig, loadLocalConfig, saveLocalConfig } from "@/modules/navigation/localStore";
import { createSeedConfig, NAV_STORAGE_KEYS, type NavConfig } from "@/modules/navigation/types";

const seed = createSeedConfig();

beforeEach(() => {
  localStorage.clear();
});

describe("localStore", () => {
  it("round-trips a config through localStorage when IDB is unavailable", async () => {
    await saveLocalConfig(seed);
    const loaded = await loadLocalConfig();
    expect(loaded?.rev).toBe(seed.rev);
    expect(loaded?.groups).toHaveLength(seed.groups.length);
    // Both the primary key and the legacy cache mirror stay warm.
    expect(localStorage.getItem(NAV_STORAGE_KEYS.local)).toBeTruthy();
    expect(localStorage.getItem(NAV_STORAGE_KEYS.cache)).toBeTruthy();
  });

  it("migrates the pre-local-first cache key", async () => {
    localStorage.setItem(NAV_STORAGE_KEYS.cache, JSON.stringify({ ...seed, rev: 7 }));
    const loaded = await loadLocalConfig();
    expect(loaded?.rev).toBe(7);
  });

  it("prefers the higher rev when both local keys exist", async () => {
    localStorage.setItem(NAV_STORAGE_KEYS.local, JSON.stringify({ ...seed, rev: 2 }));
    localStorage.setItem(NAV_STORAGE_KEYS.cache, JSON.stringify({ ...seed, rev: 5 }));
    const loaded = await loadLocalConfig();
    expect(loaded?.rev).toBe(5);
  });

  it("handles a large config that would blow the memo content cap", async () => {
    const fat: NavConfig = {
      ...seed,
      rev: 2,
      groups: [
        {
          id: "g-fat",
          name: "fat",
          collapsed: false,
          items: Array.from({ length: 200 }, (_, i) => ({
            id: `c-${i}`,
            title: `Card ${i} ${"p".repeat(80)}`,
            url: `https://example.com/${i}`,
            note: "n".repeat(200),
            updatedAt: Date.now(),
          })),
        },
      ],
    };
    await saveLocalConfig(fat);
    const loaded = await loadLocalConfig();
    expect(loaded?.groups[0].items).toHaveLength(200);
    // Comfortably past the 8192-char memo backup cap.
    expect(JSON.stringify(loaded).length).toBeGreaterThan(8192);
  });

  it("clears both keys", async () => {
    await saveLocalConfig(seed);
    await clearLocalConfig();
    expect(await loadLocalConfig()).toBeNull();
    expect(localStorage.getItem(NAV_STORAGE_KEYS.local)).toBeNull();
    expect(localStorage.getItem(NAV_STORAGE_KEYS.cache)).toBeNull();
  });

  it("returns null for garbage payloads", async () => {
    localStorage.setItem(NAV_STORAGE_KEYS.local, "not json");
    expect(await loadLocalConfig()).toBeNull();
  });
});
