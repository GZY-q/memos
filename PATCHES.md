# PATCHES.md

Audit log for upstream-file edits made by the self-contained navigation module
(`web/src/modules/navigation/`). Every edit outside that directory is recorded
here so an upstream rebase can be checked entry by entry.

Base commit: `3227748` (`fix(scheduler): correct cron calendar day matching (#6306)`).

---

## Patch 1: `web/src/router/routes.ts`

```ts
export const ROUTES = {
  ...
  MAP: "/map",
  NAVIGATION: "/navigation",
  VIEWS: "/views",
  ...
} as const;
```

- **Reason**: Register the `/navigation` route constant so the router and sidebar
  share one source of truth.
- **Upstream risk**: Minimal. `ROUTES` is an additive `as const` map; no existing
  key changed. A rebase that inserts a new key near `MAP` is a trivial 1-line
  conflict.

---

## Patch 2: `web/src/router/index.tsx`

```ts
// PATCH(navigation): route component lives inside the self-contained module.
const Navigation = lazyWithReload(() => import("@/modules/navigation/NavigationPage"));
```

and, in the `RequireAuthRoute` → `RequireFullInitializationRoute` subtree:

```ts
{ path: Routes.ATTACHMENTS, element: <Attachments /> },
{ path: Routes.MAP, element: <MemoMap /> },
{ path: Routes.NAVIGATION, element: <Navigation /> },
{ path: Routes.INBOX, element: <Inboxes /> },
{ path: Routes.SETTING, element: <Setting /> },
```

- **Reason**: Mount the lazy-loaded page under the same guard stack as Map and
  Attachments (signed-in + fully initialized), since config lives in a memo and
  needs an initialized user.
- **Upstream risk**: Low. Both edits are additive lines. The lazy import is
  self-contained; the route entry sits inside an existing guard subtree. A rebase
  that reorders the route children is a 1-line conflict.

---

## Patch 3: `web/src/components/AppSidebar/AppSidebar.tsx`

Four additive edits inside `AppSidebar.tsx`:

1. Icon import — `CompassIcon` added to the lucide-react import block.
2. Label import — `import { useNavStrings } from "@/modules/navigation/i18n";`
   (direct import, **not** the `@/modules/navigation` barrel, so the eager
   sidebar bundle never pulls in the ConnectRPC-backed storage layer).
3. Hook — `const nav = useNavStrings();` at the top of `GlobalNavigation`.
4. Entry — a new `GlobalNavItem` appended to the signed-in `items` array:

```ts
{
  id: "navigation",
  label: nav.sidebarLabel,
  path: ROUTES.NAVIGATION,
  icon: CompassIcon,
  active: Boolean(matchPath(ROUTES.NAVIGATION, location.pathname)),
},
```

- **Reason**: Add the compact navigation pill to the left icon rail. The
  hook point is `GlobalNavigation`'s signed-in `items` array (the
  calendar/map/attachments group), not `CommonSidebarContent` — the latter only
  renders on common routes (`/navigation`, `/about`) and would not show the entry
  on the rest of the app.
- **Upstream risk / known visual impact**: The signed-in navigator is a vertical
  icon rail (demo-style strip). Adding a sixth destination only grows that
  column; no horizontal budget. Also note `/navigation` is not a collection
  route, so `getSidebarRouteKind` resolves it to `"common"` and the page's
  panel renders the default `CommonSidebarContent` (About + resource links) —
  no `routes.ts` change needed.

## Patch 4: signed-in sidebar restores the classic dual-column layout

`AppSidebar.tsx` (and the width constants in `useSidebarWidth.ts`) rearrange
the signed-in chrome back toward the classic demo strip:

- **Left icon rail** (`w-14`, `border-e`): scope (Home/Explore), Calendar, Map,
  Attachments, Navigation, Search, and the collapsed account control. Every
  destination is an icon-only `size-9` square with a right-side tooltip; labels
  no longer expand in place.
- **Right panel**: keeps `SpaceSwitcher` + compose in the header, then the
  existing route content (calendar, tags, settings, …).
- **Width floor** rises to 288px (56px rail + 232px panel) so the month
  calendar still fits; default 320px.

- **Reason**: the horizontal pill navigator cramped five destinations into one
  row and only expanded the active label, which read as hard to use. The dual
  column matches the layout users already know from demo.usememos.com.
- **Upstream risk**: medium. `GlobalNavigation` and `AppSidebar`'s root flex
  direction changed; tests in `app-sidebar-logo.test.tsx`, `user-menu.test.tsx`
  and `sidebar-width.test.tsx` were updated to the icon-rail contract.

---

## Module surface (no upstream edits)

Everything else lives under `web/src/modules/navigation/`:

| File | Role |
| --- | --- |
| `index.ts` | Public barrel (types, validate, cache, merge, storage, i18n). `NavigationPage` is deliberately **not** re-exported — the router lazy-imports it by path. |
| `NavigationPage.tsx` | M1 shell page; side-effect-free placeholder. |
| `types.ts` | `NavConfig`/`NavGroup`/`NavCard`/`NavTombstone`, seed config, marker constants. |
| `validate.ts` | Hand-rolled validation for untrusted payloads (no zod dependency). |
| `storage.ts` | Raw `MemoService` RPC layer: ARCHIVED + PRIVATE config memo. |
| `merge.ts` | `rev` tiebreaker + tombstone conflict resolution. |
| `cache.ts` | localStorage cache + pre-save crash snapshot. |
| `i18n.ts` | Module-local zh/en strings; imports `react-i18next` only. |
| `navigation.css` | Lime theme scoped to `.nav-lime`, lazy-chunked. |
| `controller.ts` | M2 orchestration: load-or-seed read path + crash-safe persist + reset. |
| `useNavConfig.ts` | M2 React Query hook wrapping the controller (load / save / reset / refetch). |
| `search.ts` | M3 pure client-side filter (`searchNavConfig`) + roving-focus helpers (`flattenCards`, `cycleIndex`). |
| `reorder.ts` | M4 pure drag-and-drop helpers (`moveCard`, `moveGroup`, `clampIndex`, `findCardLocation`, `findGroupLocation`). |
| `editor.ts` | M5 pure add/edit/delete helpers (`addCard`/`updateCard`/`removeCard`, `addGroup`/`renameGroup`/`removeGroup`, `validateCardDraft`). Deletes write tombstones. |

## M2 (storage wiring + first-visit seed) — no upstream edits

All M2 work lives inside `web/src/modules/navigation/`; no new upstream patch was
needed. The read path (`controller.loadOrSeedConfig`) seeds a default
`createSeedConfig()` memo on first visit, falls back to the localStorage cache
when the memo is broken or the RPC is unreachable, and never re-seeds over a
broken memo (it stays in the Archive). The write path (`controller.persistConfig`)
bumps `rev`, snapshots the last-known-good config, then upserts the memo and
refreshes the cache. `NavigationPage` renders groups as collapsible sections of
link cards and persists collapse state through the same write path. Search (M3)
and drag (M4) remain pending.

## M3 (search) — no upstream edits

All M3 work lives inside `web/src/modules/navigation/`; no new upstream patch was
needed. Search is pure client-side: `search.ts` reshapes the in-memory config
(lowercase substring match across a card's title, URL and note), drops empty
groups, and force-expands survivors so a match is always visible. `NavigationPage`
adds a search box that filters via `searchNavConfig`, an empty-result state, and
basic keyboard interaction:

- `/` focuses the search box (ignored while an input/textarea/select/contenteditable
  is focused, and when a modifier key is held).
- `↓`/`↑` move a roving highlight across the flat list of matched cards; `Enter`
  opens the focused card via the browser's native link activation.
- `Escape` clears the query (and returns focus to the box when inside the list).

The roving highlight is styled via `[data-active="true"]` in `navigation.css`
because programmatic `.focus()` does not reliably trigger `:focus-visible`.

## M4 (drag-and-drop) — no upstream edits

All M4 work lives inside `web/src/modules/navigation/`; no new upstream patch
was needed. Like search, reordering is pure and dependency-free: `reorder.ts`
only reshapes the in-memory `NavConfig` (`moveCard` across/within groups,
`moveGroup` for section order, both using original-frame drop indexes with
same-slot no-op detection), so the drag gesture itself never touches RPC or
localStorage — `NavigationPage` wires native HTML5 drag events onto the cards
and group headers and persists the result through the same `save` path (rev
bump + crash-safe persist + cache refresh).

Details:

- Cards are dropped relative to the hovered card's vertical midpoint
  (`inset 3px` stripe above/below the card shows the land edge via
  `[data-drop-before]` / `[data-drop-after]`); empty groups accept drops too.
- Group headers get a grab handle and reorder via `[data-drop-before]` /
  `[data-drop-after]` stripes of their own.
- The dragged element dims via `[data-dragging]`; drag is disabled while
  searching so gestures never fight the filtered view.
- Tests: `web/tests/navigation-drag.test.ts` covers the pure helpers (same-slot
  no-ops, cross-group moves, clamped indexes, no input mutation).

## M5 (add / edit / delete) — no upstream edits

All M5 work lives inside `web/src/modules/navigation/`; no new upstream patch
was needed. Editing is pure the same way search and reorder are: `editor.ts`
only reshapes the in-memory `NavConfig` (card create/update/remove with
tombstones, group create/rename/remove), and `NavigationPage` persists the
result through the same `save` path.

Details:

- Cards: hover/focus actions on each card open a create/edit dialog (title,
  URL, note) with client-side validation (title required, http(s) URL, unique
  URL). Deletes go through a confirm dialog and leave a tombstone.
- Groups: header actions add a card to the group, rename it, or delete the
  group (confirm + tombstones for every card). The page header also exposes
  "Add group".
- Save failures toast `saveFailed`; a compact `saving` indicator shows while
  the mutation is in flight.
- Tests: `web/tests/navigation-editor.test.ts` covers the pure helpers;
  `web/tests/navigation-page.test.tsx` covers the dialog happy paths and
  validation.

## Final polish (a11y / keyboard / empty-error) — no upstream edits

A closing pass over the search and state surfaces, all inside
`web/src/modules/navigation/` plus tests:

- **Reachable error state.** `controller.loadOrSeedConfig` used to swallow every
  RPC failure and return `null`, which left the UI's `DegradedState` (retry)
  branch dead and mislabeled a total offline outage as "reset to defaults".
  It now rethrows when the RPC fails *and* there is no cache to fall back to,
  so `useNavConfig.isError` actually fires and the page shows a real retry
  state. A broken memo with no cache still resolves to `null` (empty state)
  rather than re-seeding over the recoverable memo.
- **Correct retry label.** `DegradedState`'s button said "Reset to defaults" but
  called `refetch`; it now uses a dedicated `retry` string (重试 / Retry).
- **Search region semantics.** The search box is wrapped in `role="search"` and
  the no-results state is a `role="status"` region so screen readers announce it.
- **Group disclosure label.** Each group toggle now carries a visually hidden
  `expand`/`collapse` verb (sr-only), previously declared in `i18n.ts` but never
  rendered, so its accessible name reads "名称 数量 折叠/展开" rather than a bare
  name + `aria-expanded`.
- **Keyboard completeness.** `↑` now also works from the search box (wraps to the
  last match), matching the list's `↓`/`↑` roving behavior.
- **Roving highlight cleanup.** `data-active` is cleared on blur when focus
  leaves the card list (a related-target check keeps it while arrow keys hop
  between cards), so the lime highlight no longer sticks after clicking away.
- **Reset rejection handling.** `reset` is now `.catch(() => {})`-wrapped where
  invoked, since the rethrown read path can make reset reject offline.

Tests: `web/tests/navigation-page.test.tsx` (11 cases) covers seeding, broken-
memo empty state, offline retry state, filtering, empty results + clear, `/`
focus, arrow-key roving + wrap, Escape clear, blur-clear, and the group
disclosure label. `web/tests/navigation-config.test.ts` gained the rethrow and
broken-memo-without-cache cases.

---

## Patch 5: TTS read-aloud (self-contained AI speech)

Outside `modules/navigation/`. Core backend lives under `internal/ai/tts/`
(Edge + Volcengine Ark) and is wired through `server/router/api/v1/ai_service.go`.
Frontend surface:

1. `web/src/components/MemoEditor/services/ttsService.ts` — Connect client for synthesize.
2. `web/src/hooks/useTTSPlayer.ts` — tab-global playback session (one memo at a time).
3. `web/src/components/MemoView/MemoReadAloudButton.tsx` (or adjacent action menu) — play/stop control next to reactions.
4. `web/src/components/Settings/AISection.tsx` — instance-level TTS provider settings.

- **Reason**: memo read-aloud without shipping audio to a third-party UI.
- **Upstream risk**: medium. Touches memo action menus and Settings; AI proto
  service may conflict if upstream adds its own speech endpoints. Prefer keeping
  provider config in instance settings rather than forking the entire AI surface.
- **State note**: `useTTSPlayer` intentionally uses module-level listeners so only
  one memo speaks per tab. If upstream adopts a player context, migrate carefully.

## Patch 6: signed-in sidebar dual-column icon rail

Already described in Patch 4. Upstream rebase risk is **medium** because
`GlobalNavigation` layout direction and width constants changed. Keep tests
(`app-sidebar-logo.test.tsx`, `user-menu.test.tsx`, `sidebar-width.test.tsx`)
aligned with the icon-rail contract after every rebase.

## Patch 7: custom search engines + TTS queue store

Outside `modules/navigation/` for TTS only:

1. `web/src/modules/navigation/searchEngines.ts` — built-in + user-defined engines
   (`{q}` template, localStorage, validation, max 8 customs).
2. `NavigationPage.tsx` + `i18n.ts` — engine chips + add/manage dialog.
3. `web/src/hooks/ttsPlayerStore.ts` + `useTTSPlayer.ts` — tab-global playback
   session with `enqueue`/`skip`/`queue` (UI button still uses `play`/`stop`).

- **Reason**: personal search shortcuts and multi-memo read-aloud without new deps.
- **Upstream risk**: low-medium. Search engines stay inside the navigation module.
  TTS store is additive next to the existing hook.

## Patch 9: SQLite FTS5 trigram + optional PG/MySQL content indexes

- `store/migration/sqlite/0.31/07__memo_fts.sql` + `LATEST.sql` — external-content
  FTS5 table (`tokenize=trigram`) with insert/update/delete triggers and backfill.
- `internal/filter/render.go` — SQLite `content.contains` with ≥3 runes compiles
  to `memo_fts MATCH` phrase query; shorter needles and other dialects keep LIKE.
- `store/migration/postgres/0.31/08__memo_content_trgm.sql` + `LATEST.sql` —
  best-effort `pg_trgm` GIN index in a DO block (no-op when CREATE EXTENSION is
  denied). Planner can then use the index for the existing `ILIKE` path; render
  is unchanged.
- `store/migration/mysql/0.31/08__memo_content_ngram.sql` + `LATEST.sql` —
  InnoDB FULLTEXT ngram index (idempotent via information_schema + PREPARE).
  `content.contains` with ≥2 runes now compiles to
  `MATCH(...) AGAINST(? IN BOOLEAN MODE)` as a boolean-mode phrase; shorter
  needles and prefix/suffix keep LIKE.

- **Reason**: substring search was a full-table LIKE scan.
- **Upstream risk**: medium (migration files + LATEST + filter renderer).

## Patch 15: MySQL ngram MATCH path + related-text filter fields

- `internal/filter/render.go` — MySQL `content.contains` (≥2 runes) compiles to
  `MATCH(memo.content) AGAINST(? IN BOOLEAN MODE)` against `idx_memo_content_ngram`;
  shorter needles and prefix/suffix keep LIKE. New `FieldKindRelatedTextMatch`
  renders `attachment_filename` / `comment` text matches as correlated EXISTS
  subqueries (no outer JOIN).
- `internal/filter/schema.go` — CEL variables `attachment_filename` and
  `comment` (contains/startsWith/endsWith only; comparison, matches(), size()
  rejected).
- `internal/filter/README.md` — documents both indexed contains paths and
  related-text fields.

- **Reason**: adopt the prepared MySQL FULLTEXT index; let filters search
  attachment filenames and comment bodies without a schema change.
- **Upstream risk**: medium (filter renderer + schema). Nested CEL syntax
  `attachment.filename.contains` was rejected as costlier than a flat
  identifier with EXISTS.


## Patch 8: auth rate limit + user export + offline shell

1. `server/router/api/v1/rate_limit.go` + Connect/gateway wiring — 10 req/min/IP
   on SignIn / RefreshToken / CreateUser (shared limiter across transports).
2. `server/router/api/v1/export_handler.go` — `GET /api/v1/export/me` (JSON or
   Markdown) for the credential's own memos; not public.
3. `web/public/sw.js` + `main.tsx` registration — network-first SPA shell cache;
   API/SSE never cached.
4. `PagedMemoList.tsx` — `content-visibility: auto` on flow-layout cards.

- **Reason**: brute-force baseline, backup export, flaky-network shell.
- **Upstream risk**: medium for rate-limit interceptor order (keep before Auth).
  Export is additive. SW is production-only and opt-out by unregister if needed.

## Patch 11: audit log for sensitive operations

- `server/audit/` — structured slog audit events (no password/token in details).
- Connect interceptor after Auth: SignIn/SignOut, Create/Update/DeleteUser,
  PAT create/delete; export success also logs `user.export`.
- `store/audit.go` + driver `audit.go` + `audit_log` tables (all three engines,
  idempotent migrations) — `StoreLogger` dual-writes slog + table.

- **Reason**: self-hosted operators need a queryable trail of auth and account changes.
- **Upstream risk**: medium (new table + Driver interface methods). Additive interceptor;
  greppable `msg=audit` lines remain.

## Patch 12: navigation module UI split

`NavigationPage.tsx` (1748 lines) extracted into sibling modules under
`web/src/modules/navigation/` (SearchSpotlight, NavGroupSection, NavCardTile,
dialogs, DnD/keyboard/clipboard/engines/bookmark hooks). Page shell is ~358
lines. Pure logic files were already separate.

- **Reason**: maintainability without behavior change.
- **Upstream risk**: low if kept inside the module directory (PATCHES.md only
  tracks edits outside it).

## Patch 13: admin audit query API

- `server/router/api/v1/audit_handler.go` — `GET /api/v1/audit-logs` for
  `RoleAdmin` only (limit/action/outcome/username filters).
- `ColumnGrid.tsx` — `content-visibility: auto` on packed memo tiles.

- **Reason**: operators need to query the audit trail without SQL; large grids
  skip offscreen paint.
- **Upstream risk**: low. Native Echo route like export; not a PublicMethod.

## Patch 14: admin audit log settings UI

- `web/src/components/Settings/AuditLogSection.tsx` + section registration —
  admin Settings → 审计日志 filters by action/outcome/username.

- **Reason**: query the audit trail without curl/SQL.
- **Upstream risk**: low. Additive admin section; az locale filled from English
  for the new keys so the locale-alignment test stays green.

## Patch 15: offline draft queue (wave2)

New self-contained modules under `web/src/lib/offline/` (idb helper, pure
queue logic, IndexedDB store, `useOfflineDraftQueue`). Upstream touchpoints:

- `web/src/main.tsx` — mount `useOfflineDraftQueue()` next to
  `useLiveMemoRefresh()` so the queue drains on `online`.
- `web/src/components/MemoEditor/hooks/useMemoSave.ts` — network-shaped save
  failures enqueue a local draft (toast「已保存到本地草稿」) instead of a hard error.
- `web/src/components/MemoEditor/hooks/useAutoSave.ts` — dual-write drafts into
  IndexedDB alongside the existing localStorage `cacheService`.
- `web/src/components/MemoEditor/Toolbar/EditorToolbar.tsx` — offline badge.
- `web/src/hooks/useOnlineStatus.ts` — shared online/offline listener.
- `web/public/sw.js` — unchanged; already never caches `/api/` GET responses.

- **Reason**: keep in-progress memos recoverable offline and auto-submit after reconnect.
- **Upstream risk**: low-medium. `useMemoSave` catch-path is additive; rebase
  conflicts only if upstream rewrites the save transaction.

## Patch 16: TTS audio cache (wave2)

- `web/src/lib/tts/audioCache.ts` — FNV-1a content hash + LRU eviction (50
  entries / 50MB).
- `web/src/lib/tts/idbAudioCache.ts` — IndexedDB blob store.
- `web/src/hooks/useTTSPlayer.ts` — play path checks the cache before
  `ttsService.synthesize` and writes back on miss.

- **Reason**: skip redundant synthesize RPCs for repeated plays of the same memo text.
- **Upstream risk**: low. Only the TTS `start` IO path changed; upstream has no TTS.

## Patch 17: audit page time range + pagination + CSV (wave2)

- `store/audit.go` + `store/db/{sqlite,postgres,mysql}/audit.go` —
  `FindAuditLog.Offset` and `SinceTs` with `LIMIT/OFFSET` and `created_ts >=`.
- `server/router/api/v1/audit_handler.go` — `offset` and `since` query params
  (pure `parseAuditLogQueryParams` for tests).
- `web/src/components/Settings/AuditLogSection.tsx` — today/7d/all range,
  offset paging (50/page), client-side CSV export via `auditCsv.ts`.
- Locales: `en.json`, `zh-Hans.json` additive keys under
  `editor.offline-*` and `setting.audit-logs.range-*` / `export-csv` / paging.

- **Reason**: operators need bounded pages and offline export of the audit trail.
- **Upstream risk**: low. All fields/params additive; existing list queries unchanged.

## Patch 18: navigation config local-first storage (wave2)

Module-internal (no new upstream files). The navigation config's primary
persistence moved off the ARCHIVED+PRIVATE memo onto browser storage:

- `web/src/modules/navigation/localStore.ts` — IndexedDB (`nav-config-store`)
  with localStorage fallback (`nav-config-local`, mirroring the legacy
  `nav-config-cache` key). Higher-`rev` wins when both backends have a copy.
- `controller.ts` — read path is local-first: prefer local, merge with the memo
  only when the memo `rev` is strictly newer (`mergeNavConfigs`), migrate a
  memo-only config into local, seed locally when the RPC is down. Write path
  always writes local, then upserts the memo backup only when
  `buildConfigContent(config).length <= NAV_CONFIG_MEMO_CONTENT_LIMIT` (8192,
  the server default). Oversized configs save locally and return
  `memoSync: "skipped-too-large"`; a failed backup RPC returns `"failed"` and
  never rolls back the local save.
- `NavigationPage` — persistent `nav-local-only-note` hint when the last save
  skipped the memo backup; offline note when `memoSync === "failed"`.
- `useBookmarkImport` — large imports are no longer refused at 65k; only a 2MB
  local soft ceiling blocks, and the persist path decides memo-backup skip.
- `types.ts` — `NAV_CONFIG_CONTENT_LIMIT` (65000) replaced by
  `NAV_CONFIG_MEMO_CONTENT_LIMIT` (8192) + `NAV_CONFIG_LOCAL_SOFT_LIMIT` (2MB).

- **Reason**: the server memo content cap (default 8192) made large bookmark
  walls unsaveable. Local storage is multi-MB and always available; the memo
  is an optional cross-device sync backup.
- **Upstream risk**: none outside the module. Cross-device sync still works via
  the memo when the body fits; oversized walls are device-local until trimmed
  or the instance `contentLengthLimit` is raised.
- **Tests**: `web/tests/navigation-config.test.ts`,
  `navigation-local-store.test.ts`, `navigation-local-only-note.test.tsx`,
  `navigation-page.test.tsx`.

## Patch 19: flow-list contain threshold + virtualization evaluation (wave2)

- `web/src/components/PagedMemoList/flowContain.ts` — `FLOW_CONTAIN_THRESHOLD`
  (40) and `flowCardContainStyle(itemCount)`. Flow cards always keep
  `content-visibility: auto` + `contain-intrinsic-size: auto 240px`; at/above
  the threshold they also get `contain: content`.
- `PagedMemoList.tsx` flow branch uses the helper instead of an inline style.
- ColumnGrid already applied `content-visibility: auto` on every packed tile
  (Patch 13) — unchanged.

**Virtualization evaluation**: full windowed virtualization (mount/unmount by
viewport) is intentionally **not** adopted. ColumnGrid's absolute packing
depends on measuring every card once to assign columns and running y-offsets;
unmounting offscreen tiles would force estimate-only layouts and thrash on
scroll. Native `content-visibility: auto` already skips offscreen layout and
paint while keeping DOM (and therefore drag state, focus, and measurement)
intact. Navigation cards use the same trick via `.nav-page-card-shell`. The
threshold switch adds a cheap `contain: content` on large flow lists without
changing mount behaviour.

- **Upstream risk**: low. One additive helper + one style swap in the flow
  branch. Tests: `web/tests/memo-list-contain.test.ts`.

## Repo hygiene notes (local only)

Local runtime artifacts must stay out of git:

- `memos_prod.db`, `memos_prod.db-shm`, `memos_prod.db-wal`, `*.sqlite*`
- `.playwright-cli/` automation scratch
- `server/router/frontend/dist/` build output (produced by `pnpm release`)

`.gitignore` now covers these. Files that were previously tracked are removed
from the index in the improve branch; history rewrite is intentionally **not**
performed here — if secrets ever landed in a db commit, rotate them and consider
a separate `git filter-repo` pass with explicit approval.
