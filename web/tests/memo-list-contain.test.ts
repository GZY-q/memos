import { describe, expect, it } from "vitest";
import { FLOW_CONTAIN_THRESHOLD, flowCardContainStyle, shouldUseFlowContain } from "@/components/PagedMemoList/flowContain";

describe("flow contain threshold", () => {
  it("stays off below the threshold", () => {
    expect(shouldUseFlowContain(0)).toBe(false);
    expect(shouldUseFlowContain(FLOW_CONTAIN_THRESHOLD - 1)).toBe(false);
    expect(flowCardContainStyle(10).contain).toBeUndefined();
  });

  it("turns on at the threshold and above", () => {
    expect(shouldUseFlowContain(FLOW_CONTAIN_THRESHOLD)).toBe(true);
    expect(shouldUseFlowContain(FLOW_CONTAIN_THRESHOLD + 100)).toBe(true);
    expect(flowCardContainStyle(FLOW_CONTAIN_THRESHOLD).contain).toBe("content");
  });

  it("always keeps content-visibility for offscreen paint skip", () => {
    const small = flowCardContainStyle(1);
    const large = flowCardContainStyle(500);
    expect(small.contentVisibility).toBe("auto");
    expect(large.contentVisibility).toBe("auto");
    expect(small.containIntrinsicBlockSize).toBe("auto 240px");
    expect(large.containIntrinsicBlockSize).toBe("auto 240px");
  });

  it("accepts a custom threshold", () => {
    expect(shouldUseFlowContain(5, 5)).toBe(true);
    expect(flowCardContainStyle(4, 5).contain).toBeUndefined();
    expect(flowCardContainStyle(5, 5).contain).toBe("content");
  });
});
