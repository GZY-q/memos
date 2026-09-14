import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadOrSeedConfig, persistConfig, resetConfig, resolveLocalAndMemo } from "@/modules/navigation/controller";
import { loadLocalConfig } from "@/modules/navigation/localStore";
import { buildConfigContent } from "@/modules/navigation/storage";
import { createSeedConfig, NAV_CONFIG_MEMO_CONTENT_LIMIT, NAV_STORAGE_KEYS, type NavConfig } from "@/modules/navigation/types";
import { State } from "@/types/proto/api/v1/common_pb";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const state = vi.hoisted(() => ({
  listMemos: vi.fn(),
  createMemo: vi.fn(),
  updateMemo: vi.fn(),
  deleteMemo: vi.fn(),
}));

vi.mock("@/connect", () => ({
  memoServiceClient: {
    listMemos: state.listMemos,
    createMemo: state.createMemo,
    updateMemo: state.updateMemo,
    deleteMemo: state.deleteMemo,
  },
}));

const memo = (name: string, content: string) =>
  create(MemoSchema, {
    name,
    content,
    state: State.ARCHIVED,
    visibility: Visibility.PRIVATE,
    updateTime: { seconds: 1_700_000_000n, nanos: 0 },
  });

const seedConfig = createSeedConfig();

const writeLocal = (config: NavConfig) => {
  localStorage.setItem(NAV_STORAGE_KEYS.local, JSON.stringify(config));
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("loadOrSeedConfig", () => {
  it("seeds a local config and a memo backup on first visit", async () => {
    state.listMemos.mockResolvedValue({ memos: [] });
    state.createMemo.mockResolvedValue(memo("memos/seed", ""));

    const result = await loadOrSeedConfig();

    expect(result?.source).toBe("seed");
    expect(result?.memoName).toBe("memos/seed");
    expect(result?.memoSync).toBe("synced");
    expect(result?.config.groups).toHaveLength(3);
    expect(state.createMemo).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(NAV_STORAGE_KEYS.initialized)).toBe("1");
    expect(await loadLocalConfig()).not.toBeNull();
  });

  it("prefers local when present and the memo matches (no rev bump on load)", async () => {
    const local: NavConfig = { ...seedConfig, rev: 4 };
    writeLocal(local);
    state.listMemos.mockResolvedValue({ memos: [memo("memos/existing", buildConfigContent(local))] });

    const result = await loadOrSeedConfig();

    expect(result?.source).toBe("local+memo");
    expect(result?.memoName).toBe("memos/existing");
    expect(result?.config.rev).toBe(4);
    expect(result?.memoSync).toBe("synced");
    expect(state.createMemo).not.toHaveBeenCalled();
  });

  it("keeps local when it is ahead of the memo (local-only oversized edits)", async () => {
    const local: NavConfig = { ...seedConfig, rev: 9 };
    writeLocal(local);
    const older: NavConfig = { ...seedConfig, rev: 3 };
    state.listMemos.mockResolvedValue({ memos: [memo("memos/older", buildConfigContent(older))] });

    const result = await loadOrSeedConfig();

    expect(result?.source).toBe("local+memo");
    expect(result?.config.rev).toBe(9);
  });

  it("merges when the memo is newer than local", async () => {
    const local: NavConfig = { ...seedConfig, rev: 2 };
    writeLocal(local);
    const remote: NavConfig = {
      ...seedConfig,
      rev: 5,
      groups: [
        {
          id: "g-common",
          name: "常用",
          collapsed: false,
          items: [...seedConfig.groups[0].items, { id: "c-extra", title: "Extra", url: "https://extra.example", updatedAt: Date.now() }],
        },
        ...seedConfig.groups.slice(1),
      ],
    };
    state.listMemos.mockResolvedValue({ memos: [memo("memos/newer", buildConfigContent(remote))] });

    const result = await loadOrSeedConfig();

    expect(result?.source).toBe("local+memo");
    expect(result?.config.rev).toBe(6);
    expect(result?.config.groups[0].items.some((c) => c.id === "c-extra")).toBe(true);
    const stored = await loadLocalConfig();
    expect(stored?.rev).toBe(6);
  });

  it("migrates a memo-only config into local storage", async () => {
    const remote: NavConfig = { ...seedConfig, rev: 4 };
    state.listMemos.mockResolvedValue({ memos: [memo("memos/existing", buildConfigContent(remote))] });

    const result = await loadOrSeedConfig();

    expect(result?.source).toBe("memo");
    expect(result?.config.rev).toBe(4);
    expect(await loadLocalConfig()).not.toBeNull();
  });

  it("serves local when the RPC fails", async () => {
    writeLocal(seedConfig);
    state.listMemos.mockRejectedValue(new Error("offline"));

    const result = await loadOrSeedConfig();

    expect(result?.source).toBe("local");
    expect(result?.memoSync).toBe("failed");
    expect(result?.config.groups).toHaveLength(3);
  });

  it("returns null for a broken memo with no local copy (never re-seeds over it)", async () => {
    state.listMemos.mockResolvedValue({ memos: [memo("memos/broken", "nav-config:v1\n```json\nnot json\n```")] });

    const result = await loadOrSeedConfig();

    expect(result).toBeNull();
    expect(state.createMemo).not.toHaveBeenCalled();
  });

  it("falls back to local when the memo payload is broken", async () => {
    writeLocal(seedConfig);
    state.listMemos.mockResolvedValue({ memos: [memo("memos/broken", "nav-config:v1\n```json\nnot json\n```")] });

    const result = await loadOrSeedConfig();

    expect(result?.source).toBe("local");
    expect(result?.config.rev).toBe(seedConfig.rev);
    expect(state.createMemo).not.toHaveBeenCalled();
  });

  it("seeds locally on first visit when the RPC is down", async () => {
    state.listMemos.mockRejectedValue(new Error("offline"));

    const result = await loadOrSeedConfig();

    expect(result?.source).toBe("seed");
    expect(result?.memoName).toBeNull();
    expect(result?.memoSync).toBe("failed");
    expect(await loadLocalConfig()).not.toBeNull();
  });
});

describe("resolveLocalAndMemo", () => {
  it("returns whichever side exists", () => {
    expect(resolveLocalAndMemo(seedConfig, null)?.rev).toBe(seedConfig.rev);
    expect(resolveLocalAndMemo(null, seedConfig)?.rev).toBe(seedConfig.rev);
    expect(resolveLocalAndMemo(null, null)).toBeNull();
  });

  it("prefers local on equal rev", () => {
    const local: NavConfig = { ...seedConfig, rev: 3 };
    const remote: NavConfig = { ...seedConfig, rev: 3 };
    expect(resolveLocalAndMemo(local, remote)).toBe(local);
  });
});

describe("persistConfig", () => {
  it("updates the existing memo backup and bumps rev", async () => {
    state.updateMemo.mockResolvedValue(memo("memos/existing", ""));
    const next: NavConfig = { ...seedConfig, rev: 7 };

    const result = await persistConfig(next, { config: seedConfig, memoName: "memos/existing" });

    expect(result.config.rev).toBe(8);
    expect(result.memoSync).toBe("synced");
    expect(result.memoName).toBe("memos/existing");
    expect(state.updateMemo).toHaveBeenCalledTimes(1);
    expect(state.createMemo).not.toHaveBeenCalled();
    expect(await loadLocalConfig()).not.toBeNull();
  });

  it("creates a memo backup when none exists yet", async () => {
    state.listMemos.mockResolvedValue({ memos: [] });
    state.createMemo.mockResolvedValue(memo("memos/created", ""));

    const result = await persistConfig(seedConfig, { config: null, memoName: null });

    expect(result.memoName).toBe("memos/created");
    expect(result.config.rev).toBe(2);
    expect(result.memoSync).toBe("synced");
    expect(state.createMemo).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(NAV_STORAGE_KEYS.initialized)).toBe("1");
  });

  it("updates the newest existing memo instead of forking when memoName is missing", async () => {
    const existing = { ...seedConfig, rev: 3 };
    state.listMemos.mockResolvedValue({ memos: [memo("memos/existing", buildConfigContent(existing))] });
    state.updateMemo.mockResolvedValue(memo("memos/existing", ""));

    const result = await persistConfig(existing, { config: existing, memoName: null });

    expect(result.memoName).toBe("memos/existing");
    expect(state.updateMemo).toHaveBeenCalledTimes(1);
    expect(state.createMemo).not.toHaveBeenCalled();
  });

  it("saves locally and skips the memo backup when the body exceeds the content cap", async () => {
    const fatNote = "x".repeat(NAV_CONFIG_MEMO_CONTENT_LIMIT);
    const next: NavConfig = {
      ...seedConfig,
      rev: 5,
      groups: [
        {
          id: "g-common",
          name: "常用",
          collapsed: false,
          items: [{ id: "c-fat", title: "Fat", url: "https://fat.example", note: fatNote, updatedAt: Date.now() }],
        },
      ],
    };

    const result = await persistConfig(next, { config: seedConfig, memoName: "memos/existing" });

    expect(result.memoSync).toBe("skipped-too-large");
    expect(result.config.rev).toBe(6);
    expect(state.updateMemo).not.toHaveBeenCalled();
    expect(state.createMemo).not.toHaveBeenCalled();
    const stored = await loadLocalConfig();
    expect(stored?.rev).toBe(6);
  });

  it("treats a server content-too-long rejection as skipped-too-large", async () => {
    state.updateMemo.mockRejectedValue(new Error("invalid_argument: content too long"));

    const result = await persistConfig(seedConfig, { config: seedConfig, memoName: "memos/existing" });

    expect(result.memoSync).toBe("skipped-too-large");
    expect(result.config.rev).toBe(seedConfig.rev + 1);
    expect(await loadLocalConfig()).not.toBeNull();
  });

  it("keeps the local save when the memo backup fails for other reasons", async () => {
    state.updateMemo.mockRejectedValue(new Error("conflict"));
    const next: NavConfig = { ...seedConfig, rev: 5 };

    const result = await persistConfig(next, { config: seedConfig, memoName: "memos/existing" });

    expect(result.memoSync).toBe("failed");
    expect(result.config.rev).toBe(6);
    const stored = await loadLocalConfig();
    expect(stored?.rev).toBe(6);
  });

  it("rolls the local store back to the snapshot when the primary write fails", async () => {
    localStorage.setItem(NAV_STORAGE_KEYS.local, JSON.stringify(seedConfig));
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    // Snapshot write also uses setItem — allow the pre-save snapshot through, then fail.
    setItem.mockImplementation((key: string) => {
      if (String(key).endsWith(":snapshot")) return;
      throw new Error("quota");
    });

    const next: NavConfig = { ...seedConfig, rev: 5 };
    await expect(persistConfig(next, { config: seedConfig, memoName: "memos/existing" })).rejects.toThrow();
    setItem.mockRestore();
  });
});

describe("resetConfig", () => {
  it("deletes the memo, clears local, and re-seeds", async () => {
    writeLocal({ ...seedConfig, rev: 9 });
    state.deleteMemo.mockResolvedValue({});
    state.listMemos.mockResolvedValue({ memos: [] });
    state.createMemo.mockResolvedValue(memo("memos/fresh", ""));

    const result = await resetConfig("memos/old");

    expect(state.deleteMemo).toHaveBeenCalledWith(expect.objectContaining({ name: "memos/old" }));
    expect(result?.source).toBe("seed");
    expect(result?.memoName).toBe("memos/fresh");
    expect(result?.config.rev).toBe(1);
  });

  it("still re-seeds when the delete fails", async () => {
    state.deleteMemo.mockRejectedValue(new Error("gone"));
    state.listMemos.mockResolvedValue({ memos: [] });
    state.createMemo.mockResolvedValue(memo("memos/fresh", ""));

    const result = await resetConfig("memos/old");

    expect(result?.source).toBe("seed");
  });
});
