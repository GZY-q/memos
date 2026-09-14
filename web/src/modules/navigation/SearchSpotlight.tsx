import { ChevronsDownUpIcon, ChevronsUpDownIcon, LoaderCircleIcon, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ClipboardPanel } from "./ClipboardPanel";
import type { NavClipItem } from "./clipboard";
import { useNavStrings } from "./i18n";
import type { SearchEngine, SearchEngineId } from "./searchEngines";

/**
 * Spotlight-style search bar: engine chips, query input, and the circular
 * scope actions (collapse-all, add group, import bookmarks, clipboard).
 */
export const SearchSpotlight = ({
  isSaving,
  engines,
  engineId,
  onSelectEngine,
  onAddEngineClick,
  searchRef,
  query,
  onQueryChange,
  onPaste,
  onSearchKeyDown,
  onClear,
  hasExpandedGroup,
  allGroupsCollapsed,
  isSearching,
  groupCount,
  onToggleCollapseAll,
  onAddGroup,
  importInputRef,
  onImportFile,
  onImportClick,
  clipboardOpen,
  onClipboardOpenChange,
  clips,
  clipPreviews,
  copiedId,
  onUseClipText,
  onCopyClip,
  onRemoveClip,
}: {
  isSaving: boolean;
  engines: SearchEngine[];
  engineId: SearchEngineId;
  onSelectEngine: (id: SearchEngineId) => void;
  onAddEngineClick: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onPaste: (event: ReactClipboardEvent<HTMLInputElement>) => void;
  onSearchKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void;
  onClear: () => void;
  hasExpandedGroup: boolean;
  allGroupsCollapsed: boolean;
  isSearching: boolean;
  groupCount: number;
  onToggleCollapseAll: () => void;
  onAddGroup: () => void;
  importInputRef: RefObject<HTMLInputElement | null>;
  onImportFile: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportClick: () => void;
  clipboardOpen: boolean;
  onClipboardOpenChange: (open: boolean) => void;
  clips: NavClipItem[];
  clipPreviews: Record<string, string>;
  copiedId: string | null;
  onUseClipText: (text: string) => void;
  onCopyClip: (item: NavClipItem) => void;
  onRemoveClip: (item: NavClipItem) => void;
}) => {
  const t = useNavStrings();
  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {isSaving ? (
          <span className="flex items-center gap-1 text-xs text-muted-foreground" data-testid="nav-saving">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            {t.saving}
          </span>
        ) : null}
        <div role="search" className="nav-spotlight relative min-w-0 flex-1">
          <div
            className="nav-engine-tabs absolute left-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5"
            data-testid="nav-engine-tabs"
            role="group"
            aria-label={t.engineTabsLabel}
          >
            {engines.map((engine) => (
              <Tooltip key={engine.id}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      data-testid={`nav-engine-${engine.id}`}
                      data-active={engine.id === engineId ? "true" : undefined}
                      aria-label={engine.label}
                      aria-pressed={engine.id === engineId}
                      className="nav-engine-chip"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onSelectEngine(engine.id)}
                    />
                  }
                >
                  {engine.shortLabel}
                </TooltipTrigger>
                <TooltipContent side="bottom">{engine.label}</TooltipContent>
              </Tooltip>
            ))}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    data-testid="nav-add-engine"
                    aria-label={t.addSearchEngine}
                    className="nav-engine-chip"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={onAddEngineClick}
                  />
                }
              >
                <PlusIcon className="size-3" strokeWidth={2.2} />
              </TooltipTrigger>
              <TooltipContent side="bottom">{t.addSearchEngine}</TooltipContent>
            </Tooltip>
          </div>
          <Input
            ref={searchRef}
            value={query}
            onChange={onQueryChange}
            onPaste={onPaste}
            onKeyDown={onSearchKeyDown}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchPlaceholder}
            className="nav-spotlight-input h-12 rounded-full pr-10 pl-36 text-base"
            data-testid="nav-search-input"
          />
          {query ? (
            <button
              type="button"
              onClick={onClear}
              aria-label={t.clearSearch}
              className="absolute right-3 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={hasExpandedGroup ? t.collapseAll : t.expandAll}
                data-testid="nav-toggle-collapse-all"
                disabled={isSearching || groupCount === 0}
                onClick={onToggleCollapseAll}
                className="nav-spotlight-action flex size-12 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              />
            }
          >
            {allGroupsCollapsed ? (
              <ChevronsUpDownIcon className="size-5" strokeWidth={1.8} />
            ) : (
              <ChevronsDownUpIcon className="size-5" strokeWidth={1.8} />
            )}
          </TooltipTrigger>
          <TooltipContent side="bottom">{hasExpandedGroup ? t.collapseAll : t.expandAll}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t.addGroup}
                data-testid="nav-add-group"
                onClick={onAddGroup}
                className="nav-spotlight-action flex size-12 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              />
            }
          >
            <PlusIcon className="size-5" strokeWidth={1.8} />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.addGroup}</TooltipContent>
        </Tooltip>
        <input
          ref={importInputRef}
          type="file"
          accept=".html,.htm,text/html"
          className="hidden"
          data-testid="nav-import-input"
          onChange={(event) => void onImportFile(event)}
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={t.importBookmarks}
                title={t.importBookmarksHint}
                data-testid="nav-import-button"
                onClick={onImportClick}
                className="nav-spotlight-action flex size-12 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              />
            }
          >
            <UploadIcon className="size-5" strokeWidth={1.8} />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t.importBookmarks}</TooltipContent>
        </Tooltip>
        <ClipboardPanel
          open={clipboardOpen}
          onOpenChange={onClipboardOpenChange}
          clips={clips}
          clipPreviews={clipPreviews}
          copiedId={copiedId}
          onUseText={onUseClipText}
          onCopy={onCopyClip}
          onRemove={onRemoveClip}
        />
      </div>
    </TooltipProvider>
  );
};
