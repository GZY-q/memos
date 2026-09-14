import { describe, expect, it } from "vitest";
import { setAllGroupsCollapsed } from "@/modules/navigation/editor";
import type { NavConfig } from "@/modules/navigation/types";

const config = (collapsed: boolean[]): NavConfig => ({
  version: 1,
  rev: 1,
  updatedAt: 1,
  groups: collapsed.map((flag, index) => ({
    id: `g${index}`,
    name: `G${index}`,
    collapsed: flag,
    items: [],
  })),
  tombstones: [],
});

describe("setAllGroupsCollapsed", () => {
  it("collapses every open group", () => {
    const next = setAllGroupsCollapsed(config([false, true, false]), true);
    expect(next.groups.map((g) => g.collapsed)).toEqual([true, true, true]);
  });

  it("expands every closed group", () => {
    const next = setAllGroupsCollapsed(config([true, true]), false);
    expect(next.groups.map((g) => g.collapsed)).toEqual([false, false]);
  });

  it("returns the same reference when already uniform", () => {
    const source = config([true, true]);
    expect(setAllGroupsCollapsed(source, true)).toBe(source);
  });
});
