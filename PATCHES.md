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

## Repo hygiene notes (local only)

Local runtime artifacts must stay out of git:

- `memos_prod.db`, `memos_prod.db-shm`, `memos_prod.db-wal`, `*.sqlite*`
- `.playwright-cli/` automation scratch
- `server/router/frontend/dist/` build output (produced by `pnpm release`)

`.gitignore` now covers these. Files that were previously tracked are removed
from the index in the improve branch; history rewrite is intentionally **not**
performed here — if secrets ever landed in a db commit, rotate them and consider
a separate `git filter-repo` pass with explicit approval.
