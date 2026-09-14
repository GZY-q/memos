/**
 * Flow-list containment helpers.
 *
 * Virtualization assessment (see PATCHES.md Patch 15): ColumnGrid tiles and
 * the flow list already opt into `content-visibility: auto` with a stable
 * intrinsic block size, so offscreen cards skip layout/paint without
 * unmounting. Full windowed virtualization would break absolute-positioned
 * column packing (measured heights feed assignment), drag state, and in-card
 * focus/selection. Above `FLOW_CONTAIN_THRESHOLD` cards the flow list
 * additionally applies `contain: content` to tighten each card's containing
 * block — a cheap, testable switch that does not change mount behaviour.
 */

import type { CSSProperties } from "react";

/** Above this many flow cards, also apply `contain: content`. */
export const FLOW_CONTAIN_THRESHOLD = 40;

export const shouldUseFlowContain = (itemCount: number, threshold: number = FLOW_CONTAIN_THRESHOLD): boolean => itemCount >= threshold;

/**
 * Inline style for one flow-layout memo card. Always skips offscreen
 * layout/paint via `content-visibility`; large lists gain `contain: content`.
 */
export const flowCardContainStyle = (itemCount: number, threshold: number = FLOW_CONTAIN_THRESHOLD): CSSProperties => ({
  contentVisibility: "auto",
  containIntrinsicBlockSize: "auto 240px",
  ...(shouldUseFlowContain(itemCount, threshold) ? { contain: "content" } : {}),
});
