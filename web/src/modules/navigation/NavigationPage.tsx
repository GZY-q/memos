import { WifiOffIcon } from "lucide-react";
import { type ChangeEvent, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { CardDialog, type CardDialogState } from "./CardEditDialog";
import { EngineDialog } from "./EngineDialog";
import {
  addCard,
  addGroup,
  type CardDraft,
  createCard,
  removeCard,
  removeGroup,
  renameGroup,
  setAllGroupsCollapsed,
  updateCard,
} from "./editor";
import { ConfirmDialog, type ConfirmDialogState, NameDialog, type NameDialogState, OpenAllConfirmDialog } from "./GroupEditDialog";
import { useNavStrings } from "./i18n";
import { NavGroupSection } from "./NavGroupSection";
import { DegradedState, EmptyState, LoadingState, SearchEmptyState } from "./NavStates";
import { collectGroupUrls, OPEN_ALL_CONFIRM_THRESHOLD, openUrlsInTabs } from "./openLinks";
import { SearchSpotlight } from "./SearchSpotlight";
import { flattenCards, searchNavConfig } from "./search";
import { buildSearchUrl } from "./searchEngines";
import type { NavCard, NavConfig, NavGroup } from "./types";
import { useBookmarkImport } from "./useBookmarkImport";
import { useNavClipboard } from "./useNavClipboard";
import { useNavConfig } from "./useNavConfig";
import { useNavDnd } from "./useNavDnd";
import { useNavEngines } from "./useNavEngines";
import { useNavKeyboard } from "./useNavKeyboard";
import { isValidHttpUrl } from "./validate";
import "./navigation.css";

/**
 * M5: config-backed card wall with client-side search, drag-and-drop, and
 * add/edit/delete. Search and reorder stay pure (see `search.ts` / `reorder.ts`);
 * editing is pure the same way (see `editor.ts`): dialogs only reshape the
 * in-memory config, then persist through the normal `save` path. Basic keyboard
 * interaction: `/` focuses the box, Escape clears it, and the arrow keys move a
 * roving highlight across the matched cards.
 */

const NavigationPage = () => {
  const t = useNavStrings();
  const { state, isLoading, isError, refetch, save, isSaving } = useNavConfig();

  const [query, setQuery] = useState("");
  const [engineDialogOpen, setEngineDialogOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [cardDialog, setCardDialog] = useState<CardDialogState | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [openAllConfirm, setOpenAllConfirm] = useState<{ group: NavGroup; count: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const cardRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());

  const { engines, engineId, customEngines, currentEngine, setEngineId, handleAddEngine, handleRemoveEngine } = useNavEngines();

  const openWebSearch = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const url = buildSearchUrl(currentEngine, trimmed);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, [query, currentEngine]);

  const config = state?.config ?? null;
  const filtered = useMemo(() => (config ? searchNavConfig(config, query) : null), [config, query]);
  const flatCards = useMemo(() => (filtered ? flattenCards(filtered) : []), [filtered]);
  const isSearching = query.trim() !== "";
  const canDrag = config !== null && !isSearching;

  const persist = useCallback(
    async (next: NavConfig) => {
      if (!state || next === state.config) return;
      await save(next);
    },
    [save, state],
  );

  /** Fire-and-forget persist for small edits; surfaces the offline toast. */
  const persistQuiet = useCallback(
    (next: NavConfig) => {
      void persist(next).catch(() => toast.error(t.saveFailed));
    },
    [persist, t.saveFailed],
  );

  const hasExpandedGroup = useMemo(() => (config ? config.groups.some((group) => !group.collapsed) : false), [config]);
  const allGroupsCollapsed = useMemo(
    () => (config ? config.groups.length > 0 && config.groups.every((group) => group.collapsed) : false),
    [config],
  );

  /** One-click: collapse every open group; if all are already closed, expand them. */
  const toggleCollapseAll = () => {
    if (!state || isSearching) return;
    persistQuiet(setAllGroupsCollapsed(state.config, hasExpandedGroup));
  };

  const runOpenAll = async (group: NavGroup) => {
    const urls = collectGroupUrls(group.items);
    if (urls.length === 0) return;
    const result = await openUrlsInTabs(urls);
    if (result.opened > 0) toast.success(t.openAllLinksOpened(result.opened));
    if (result.blocked > 0) toast.error(t.openAllLinksBlocked(result.blocked));
  };

  const requestOpenAll = (group: NavGroup) => {
    if (group.items.length === 0) return;
    if (group.items.length > OPEN_ALL_CONFIRM_THRESHOLD) {
      setOpenAllConfirm({ group, count: Math.min(group.items.length, 40) });
      return;
    }
    void runOpenAll(group);
  };

  const { clearSearch, handleSearchKeyDown, handleListKeyDown, handleListBlur } = useNavKeyboard({
    searchRef,
    flatCards,
    activeCardId,
    setActiveCardId,
    cardRefs,
    engineId,
    customEngines,
    setEngineId,
    openWebSearch,
    setQuery,
  });

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActiveCardId(null);
  };

  const toggleCollapse = (group: NavGroup) => {
    if (!state) return;
    const next: NavConfig = {
      ...state.config,
      groups: state.config.groups.map((g) => (g.id === group.id ? { ...g, collapsed: !g.collapsed } : g)),
    };
    persistQuiet(next);
  };

  const dnd = useNavDnd({ state: config, persistQuiet });
  const clipboard = useNavClipboard({ setQuery, setActiveCardId });
  const bookmarkImport = useBookmarkImport({ state, persist, importInputRef });

  const openCreateCard = (groupId: string) => {
    setCardDialog({ open: true, mode: "create", groupId, initial: { title: "", url: "", note: "" } });
  };

  const useClipText = (text: string) => {
    if (!state) return;
    if (isValidHttpUrl(text)) {
      let title = "";
      try {
        title = new URL(text).hostname.replace(/^www\./, "");
      } catch {
        title = "";
      }
      const groupId = state.config.groups[0]?.id;
      if (!groupId) return;
      clipboard.setClipboardOpen(false);
      setCardDialog({ open: true, mode: "create", groupId, initial: { title, url: text, note: "" } });
      return;
    }
    setQuery(text);
    setActiveCardId(null);
    clipboard.setClipboardOpen(false);
    searchRef.current?.focus();
  };

  const openEditCard = (group: NavGroup, card: NavCard) => {
    setCardDialog({
      open: true,
      mode: "edit",
      groupId: group.id,
      cardId: card.id,
      initial: { title: card.title, url: card.url, note: card.note ?? "" },
    });
  };

  const handleCardSubmit = (draft: CardDraft, targetGroupId: string) => {
    if (!state || !cardDialog) return;
    const next =
      cardDialog.mode === "create"
        ? addCard(state.config, targetGroupId, createCard(draft))
        : updateCard(state.config, cardDialog.cardId ?? "", draft);
    persistQuiet(next);
    setCardDialog(null);
  };

  const openCreateGroup = () => {
    setNameDialog({ open: true, mode: "create", initialName: "" });
  };

  const openRenameGroup = (group: NavGroup) => {
    setNameDialog({ open: true, mode: "rename", groupId: group.id, initialName: group.name });
  };

  const handleNameSubmit = (name: string) => {
    if (!state || !nameDialog) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const next =
      nameDialog.mode === "create" ? addGroup(state.config, trimmed) : renameGroup(state.config, nameDialog.groupId ?? "", trimmed);
    persistQuiet(next);
    setNameDialog(null);
  };

  const openDeleteCard = (group: NavGroup, card: NavCard) => {
    setConfirmDialog({ open: true, kind: "card", groupId: group.id, cardId: card.id });
  };

  const openDeleteGroup = (group: NavGroup) => {
    setConfirmDialog({ open: true, kind: "group", groupId: group.id });
  };

  const handleConfirmDelete = () => {
    if (!state || !confirmDialog) return;
    const next =
      confirmDialog.kind === "card"
        ? removeCard(state.config, confirmDialog.cardId ?? "")
        : removeGroup(state.config, confirmDialog.groupId);
    persistQuiet(next);
    setConfirmDialog(null);
  };

  const registerCardRef = useCallback((id: string, el: HTMLAnchorElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  }, []);

  const isDegraded = state?.source === "cache";

  return (
    <div className="flex w-full flex-col gap-5">
      {isLoading ? (
        <LoadingState />
      ) : isError && !config ? (
        <DegradedState onRetry={() => void refetch()} />
      ) : !config ? (
        <EmptyState onRetry={() => void refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          {isDegraded ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="nav-degraded-note">
              <WifiOffIcon className="size-3.5" />
              {t.degradedBody}
            </p>
          ) : null}

          <SearchSpotlight
            isSaving={isSaving}
            engines={engines}
            engineId={engineId}
            onSelectEngine={setEngineId}
            onAddEngineClick={() => setEngineDialogOpen(true)}
            searchRef={searchRef}
            query={query}
            onQueryChange={handleQueryChange}
            onPaste={clipboard.handleSearchPaste}
            onSearchKeyDown={handleSearchKeyDown}
            onClear={clearSearch}
            hasExpandedGroup={hasExpandedGroup}
            allGroupsCollapsed={allGroupsCollapsed}
            isSearching={isSearching}
            groupCount={config.groups.length}
            onToggleCollapseAll={toggleCollapseAll}
            onAddGroup={openCreateGroup}
            importInputRef={importInputRef}
            onImportFile={bookmarkImport.handleImportFile}
            onImportClick={bookmarkImport.openImportPicker}
            clipboardOpen={clipboard.clipboardOpen}
            onClipboardOpenChange={(open) => {
              clipboard.setClipboardOpen(open);
              if (open) void clipboard.captureSystemClipboard();
            }}
            clips={clipboard.clips}
            clipPreviews={clipboard.clipPreviews}
            copiedId={clipboard.copiedId}
            onUseClipText={useClipText}
            onCopyClip={(item) => void clipboard.copyClip(item)}
            onRemoveClip={(item) => clipboard.removeClipFromList(item.id)}
          />

          {isSearching && flatCards.length === 0 ? (
            <SearchEmptyState onClear={clearSearch} />
          ) : (
            <div className="flex flex-col gap-5" onKeyDown={handleListKeyDown} onBlur={handleListBlur}>
              {filtered?.groups.map((group, groupIndex) => (
                <NavGroupSection
                  key={group.id}
                  group={group}
                  groupIndex={groupIndex}
                  canDrag={canDrag}
                  draggingGroupId={dnd.draggingGroupId}
                  groupDropHint={dnd.groupDropHint}
                  draggingCardId={dnd.draggingCardId}
                  cardDropHint={dnd.cardDropHint}
                  activeCardId={activeCardId}
                  onToggleCollapse={toggleCollapse}
                  onOpenAll={requestOpenAll}
                  onAddCard={openCreateCard}
                  onRenameGroup={openRenameGroup}
                  onDeleteGroup={openDeleteGroup}
                  onEditCard={openEditCard}
                  onDeleteCard={openDeleteCard}
                  onActiveCardChange={setActiveCardId}
                  registerCardRef={registerCardRef}
                  onGroupDragStart={dnd.handleGroupDragStart}
                  onGroupDragOver={dnd.handleGroupDragOver}
                  onGroupDrop={dnd.handleGroupDrop}
                  onDragEnd={dnd.endDrag}
                  onCardDragStart={dnd.handleCardDragStart}
                  onCardDragOver={dnd.handleCardDragOver}
                  onCardDrop={dnd.handleCardDrop}
                  onEmptyGroupDragOver={dnd.handleEmptyGroupDragOver}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {cardDialog && config ? (
        <CardDialog state={cardDialog} config={config} onClose={() => setCardDialog(null)} onSubmit={handleCardSubmit} />
      ) : null}
      {nameDialog ? <NameDialog state={nameDialog} onClose={() => setNameDialog(null)} onSubmit={handleNameSubmit} /> : null}
      {engineDialogOpen ? (
        <EngineDialog
          customEngines={customEngines}
          onClose={() => setEngineDialogOpen(false)}
          onAdd={handleAddEngine}
          onRemove={handleRemoveEngine}
        />
      ) : null}
      {confirmDialog ? (
        <ConfirmDialog state={confirmDialog} onClose={() => setConfirmDialog(null)} onConfirm={handleConfirmDelete} />
      ) : null}
      {openAllConfirm ? (
        <OpenAllConfirmDialog
          count={openAllConfirm.count}
          onClose={() => setOpenAllConfirm(null)}
          onConfirm={() => {
            const group = openAllConfirm.group;
            setOpenAllConfirm(null);
            void runOpenAll(group);
          }}
        />
      ) : null}
    </div>
  );
};

export default NavigationPage;
