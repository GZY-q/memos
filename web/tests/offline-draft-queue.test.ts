import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import {
  flushQueuedSaves,
  type OfflineQueuedSave,
  offlineSaveId,
  pruneOfflineDrafts,
  removeQueuedSave,
  shouldQueueSaveError,
  upsertQueuedSave,
} from "@/lib/offline/draftQueue";

const item = (overrides: Partial<OfflineQueuedSave> = {}): OfflineQueuedSave => ({
  id: "create:new",
  kind: "create",
  content: "hello",
  visibility: 0,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

describe("offline draft queue", () => {
  it("builds stable save ids by kind and target", () => {
    expect(offlineSaveId("create")).toBe("create:new");
    expect(offlineSaveId("update", "memos/1")).toBe("update:memos/1");
    expect(offlineSaveId("comment", "memos/2")).toBe("comment:memos/2");
  });

  it("replaces a retry for the same id and keeps newest first", () => {
    const first = item({ content: "v1", updatedAt: 1 });
    const second = item({ content: "v2", updatedAt: 2 });
    const other = item({ id: "create:other", content: "other", updatedAt: 3 });

    const merged = upsertQueuedSave([first], second);
    expect(merged).toHaveLength(1);
    expect(merged[0].content).toBe("v2");

    const withOther = upsertQueuedSave(merged, other);
    expect(withOther.map((entry) => entry.id)).toEqual(["create:other", "create:new"]);
  });

  it("caps the queue size", () => {
    const many = Array.from({ length: 60 }, (_, index) => item({ id: `id-${index}`, updatedAt: index }));
    const merged = upsertQueuedSave(many, item({ id: "fresh", updatedAt: 100 }), 50);
    expect(merged).toHaveLength(50);
    expect(merged[0].id).toBe("fresh");
  });

  it("removes by id", () => {
    expect(removeQueuedSave([item(), item({ id: "other" })], "create:new").map((e) => e.id)).toEqual(["other"]);
  });

  it("detects network-shaped failures", () => {
    expect(shouldQueueSaveError(new ConnectError("unavailable", Code.Unavailable))).toBe(true);
    expect(shouldQueueSaveError(new ConnectError("timeout", Code.DeadlineExceeded))).toBe(true);
    expect(shouldQueueSaveError(new TypeError("Failed to fetch"))).toBe(true);
    expect(shouldQueueSaveError(new Error("Failed to fetch"))).toBe(true);
    expect(shouldQueueSaveError(new ConnectError("nope", Code.PermissionDenied))).toBe(false);
    expect(shouldQueueSaveError(new Error("validation failed"))).toBe(false);
  });

  it("flushes oldest first and stops on the first failure", async () => {
    const older = item({ id: "a", updatedAt: 1, content: "older" });
    const newer = item({ id: "b", updatedAt: 2, content: "newer" });
    const attempted: string[] = [];

    const result = await flushQueuedSaves([newer, older], async (entry) => {
      attempted.push(entry.content);
      if (entry.content === "newer") throw new Error("still offline");
    });

    expect(attempted).toEqual(["older", "newer"]);
    expect(result.flushed.map((e) => e.id)).toEqual(["a"]);
    expect(result.failed.map((e) => e.id)).toEqual(["b"]);
  });

  it("prunes empty and stale drafts", () => {
    const now = Date.now();
    const list = [
      { id: "empty", content: "   ", updatedAt: now },
      { id: "fresh", content: "keep me", updatedAt: now - 1000 },
      { id: "stale", content: "old", updatedAt: now - 20 * 24 * 60 * 60 * 1000 },
    ];
    const pruned = pruneOfflineDrafts(list, now);
    expect(pruned.map((d) => d.id)).toEqual(["fresh"]);
  });
});
