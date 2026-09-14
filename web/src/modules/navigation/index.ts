/**
 * Public surface of the navigation module.
 *
 * Everything the feature owns lives under `modules/navigation/`; the only
 * upstream edits are those documented in `PATCHES.md` (route + sidebar).
 *
 * Config persistence is local-first (`localStore.ts`: IndexedDB with a
 * localStorage fallback); the ARCHIVED+PRIVATE memo in `storage.ts` is an
 * optional cross-device backup, skipped when the body exceeds the server
 * content cap.
 *
 * Two import rules keep the bundle honest:
 * - `NavigationPage` is NOT re-exported here. The router lazy-imports it by path
 *   so the page, its CSS and its RPC layer stay in their own chunk.
 * - Upstream code that only needs a label (the sidebar patch) must import
 *   `@/modules/navigation/i18n` directly, not this barrel — the barrel pulls in
 *   the ConnectRPC-backed storage layer, which has no business in the eager
 *   sidebar bundle.
 */

export * from "./bookmarks";
export * from "./cache";
export * from "./clipboard";
export * from "./controller";
export * from "./editor";
export * from "./i18n";
export * from "./localStore";
export * from "./merge";
export * from "./reorder";
export * from "./searchEngines";
export * from "./storage";
export * from "./types";
export * from "./useNavConfig";
export * from "./validate";
