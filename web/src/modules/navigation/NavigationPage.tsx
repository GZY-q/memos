import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ClipboardIcon,
  CopyIcon,
  FileIcon,
  GripVerticalIcon,
  ImageIcon,
  LoaderCircleIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SquareArrowOutUpRightIcon,
  TrashIcon,
  UploadIcon,
  WifiOffIcon,
  XIcon,
} from "lucide-react";
import type {
  ChangeEvent,
  FormEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { importBookmarkFolders, parseBookmarkHtml } from "./bookmarks";
import {
  addClip,
  addFileClip,
  addImageClip,
  addRichClip,
  buildClipWritePayload,
  clipPartKey,
  formatClipSize,
  getClipBlob,
  type NavClipItem,
  previewClip,
  pruneClipBlobs,
  readClips,
  removeClip,
  writeClips,
} from "./clipboard";
import { useNavStrings } from "./i18n";
import { buildConfigContent } from "./storage";
import { NAV_CONFIG_CONTENT_LIMIT, type NavCard, type NavConfig, type NavGroup } from "./types";
import "./navigation.css";
import type { CardDraft, CardDraftError } from "./editor";
import {
  addCard,
  addGroup,
  createCard,
  removeCard,
  removeGroup,
  renameGroup,
  setAllGroupsCollapsed,
  updateCard,
  validateCardDraft,
} from "./editor";
import { collectGroupUrls, OPEN_ALL_CONFIRM_THRESHOLD, openUrlsInTabs } from "./openLinks";
import { moveCard, moveGroup } from "./reorder";
import { cycleIndex, flattenCards, searchNavConfig } from "./search";
import {
  buildSearchUrl,
  createCustomEngine,
  cycleSearchEngine,
  DEFAULT_SEARCH_ENGINE,
  type EngineDraftError,
  getSearchEngine,
  listSearchEngines,
  MAX_CUSTOM_ENGINES,
  readCustomEngines,
  readPreferredEngine,
  type SearchEngine,
  type SearchEngineId,
  validateEngineDraft,
  writeCustomEngines,
  writePreferredEngine,
} from "./searchEngines";
import { useNavConfig } from "./useNavConfig";
import { isValidHttpUrl } from "./validate";

/**
 * M5: config-backed card wall with client-side search, drag-and-drop, and
 * add/edit/delete. Search and reorder stay pure (see `search.ts` / `reorder.ts`);
 * editing is pure the same way (see `editor.ts`): dialogs only reshape the
 * in-memory config, then persist through the normal `save` path. Basic keyboard
 * interaction: `/` focuses the box, Escape clears it, and the arrow keys move a
 * roving highlight across the matched cards.
 */

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null);

interface CardDrag {
  cardId: string;
  groupId: string;
  index: number;
}

interface DropHint {
  groupId: string;
  index: number;
}

interface CardDialogState {
  open: true;
  mode: "create" | "edit";
  groupId: string;
  cardId?: string;
  initial: CardDraft;
}

interface NameDialogState {
  open: true;
  mode: "create" | "rename";
  groupId?: string;
  initialName: string;
}

interface ConfirmDialogState {
  open: true;
  kind: "card" | "group";
  groupId: string;
  cardId?: string;
}

const hostLabel = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Deterministic pastel tint so letter avatars look distinct without assets. */
const letterTint = (seed: string): { background: string; color: string } => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return {
    background: `oklch(0.86 0.06 ${hue})`,
    color: `oklch(0.38 0.1 ${hue})`,
  };
};

/** Only the site's own favicon — fail fast to a letter tile instead of chaining CDNs. */
const logoSource = (url: string): string | null => {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return null;
  }
};

const LOGO_TIMEOUT_MS = 1200;

/** Site favicon, or a first-letter avatar when the icon is missing/slow. */
const CardLogo = memo(function CardLogo({ url, title }: { url: string; title: string }) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const host = hostLabel(url);
  const letter = (host || title || "?").charAt(0).toUpperCase();
  const tint = useMemo(() => letterTint(host || title || url), [host, title, url]);
  const src = useMemo(() => logoSource(url), [url]);

  // Only start the network request once the tile is near the viewport.
  useEffect(() => {
    if (!src || failed || loaded || near) return;
    const el = frameRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "180px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src, failed, loaded, near]);

  // Hanging requests never fire onError — cut over to the letter tile on a deadline.
  useEffect(() => {
    if (!near || !src || failed || loaded) return;
    const timer = window.setTimeout(() => setFailed(true), LOGO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [near, src, failed, loaded]);

  if (!src || failed) {
    return (
      <span
        ref={frameRef}
        aria-hidden
        className="nav-page-logo-frame flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold"
        style={tint}
        data-testid="nav-card-logo-fallback"
      >
        {letter}
      </span>
    );
  }

  return (
    <span
      ref={frameRef}
      className="nav-page-logo-frame relative size-8 shrink-0 overflow-hidden rounded-lg"
      data-testid="nav-card-logo-wrap"
    >
      <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold" style={tint}>
        {letter}
      </span>
      {near ? (
        <img
          src={src}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`nav-page-logo absolute inset-0 size-full transition-opacity duration-150 ${loaded ? "opacity-100" : "opacity-0"}`}
          data-testid="nav-card-logo"
        />
      ) : null}
    </span>
  );
});

const Card = ({
  card,
  active,
  dropBefore,
  dropAfter,
  dragDisabled,
  dragging,
  cardRef,
  onFocus,
  onEdit,
  onDelete,
  onDragStartCard,
  onDragOverCard,
  onDropCard,
  onDragEndCard,
}: {
  card: NavCard;
  active: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  dragDisabled: boolean;
  dragging: boolean;
  cardRef: (el: HTMLAnchorElement | null) => void;
  onFocus: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStartCard: (event: ReactDragEvent<HTMLAnchorElement>) => void;
  onDragOverCard: (event: ReactDragEvent<HTMLAnchorElement>) => void;
  onDropCard: (event: ReactDragEvent<HTMLAnchorElement>) => void;
  onDragEndCard: () => void;
}) => {
  const t = useNavStrings();
  return (
    <div className="nav-page-card-shell group relative">
      <a
        ref={cardRef}
        href={card.url}
        target="_blank"
        rel="noreferrer"
        tabIndex={-1}
        draggable={!dragDisabled}
        data-active={active ? "true" : undefined}
        data-dragging={dragging ? "true" : undefined}
        onFocus={onFocus}
        onDragStart={onDragStartCard}
        onDragOver={onDragOverCard}
        onDrop={onDropCard}
        onDragEnd={onDragEndCard}
        data-drop-before={dropBefore ? "true" : undefined}
        data-drop-after={dropAfter ? "true" : undefined}
        className="nav-page-card flex flex-col gap-2.5 rounded-xl p-3.5 focus:outline-none"
        data-testid="nav-card"
      >
        <span className="flex items-center gap-3">
          <CardLogo url={card.url} title={card.title} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{card.title}</span>
            {card.note ? <span className="line-clamp-1 text-xs text-muted-foreground">{card.note}</span> : null}
          </span>
        </span>
        <span className="truncate text-xs text-muted-foreground/70">{hostLabel(card.url)}</span>
      </a>
      <div className="nav-page-card-actions pointer-events-none absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          aria-label={t.editCard}
          data-testid="nav-card-edit"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit();
          }}
        >
          <PencilIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          aria-label={t.deleteCard}
          data-testid="nav-card-delete"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete();
          }}
        >
          <TrashIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
};

const LoadingState = () => {
  const t = useNavStrings();
  return (
    <section className="border-border bg-card flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" />
      <span>{t.loading}</span>
    </section>
  );
};

const EmptyState = ({ onRetry }: { onRetry: () => void }) => {
  const t = useNavStrings();
  return (
    <section className="border-border bg-card flex flex-col items-start gap-3 rounded-xl border p-6">
      <h2 className="text-sm font-medium text-foreground">{t.emptyTitle}</h2>
      <p className="text-sm text-muted-foreground">{t.emptyBody}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcwIcon />
        {t.retry}
      </Button>
    </section>
  );
};

const DegradedState = ({ onRetry }: { onRetry: () => void }) => {
  const t = useNavStrings();
  return (
    <section className="border-border bg-card flex flex-col items-start gap-2 rounded-xl border p-6">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <WifiOffIcon className="size-4" />
        {t.degradedTitle}
      </h2>
      <p className="text-sm text-muted-foreground">{t.degradedBody}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcwIcon />
        {t.retry}
      </Button>
    </section>
  );
};

const SearchEmptyState = ({ onClear }: { onClear: () => void }) => {
  const t = useNavStrings();
  return (
    <section
      className="border-border bg-card flex flex-col items-start gap-2 rounded-xl border p-6"
      role="status"
      data-testid="nav-search-empty"
    >
      <h2 className="text-sm font-medium text-foreground">{t.searchEmptyTitle}</h2>
      <p className="text-sm text-muted-foreground">{t.searchEmptyBody}</p>
      <Button variant="outline" size="sm" onClick={onClear}>
        <XIcon />
        {t.clearSearch}
      </Button>
    </section>
  );
};

const draftErrorMessage = (error: CardDraftError, t: ReturnType<typeof useNavStrings>): string =>
  error === "titleRequired" ? t.titleRequired : error === "urlInvalid" ? t.urlInvalid : t.urlDuplicate;

const engineErrorMessage = (error: EngineDraftError, t: ReturnType<typeof useNavStrings>): string =>
  error === "labelRequired"
    ? t.engineLabelRequired
    : error === "urlInvalid"
      ? t.engineTemplateInvalid
      : error === "missingQueryPlaceholder"
        ? t.engineTemplateMissingQuery
        : t.engineTooMany(MAX_CUSTOM_ENGINES);

/** Add / remove user-defined engines next to the built-in chips. */
const EngineDialog = ({
  customEngines,
  onClose,
  onAdd,
  onRemove,
}: {
  customEngines: SearchEngine[];
  onClose: () => void;
  onAdd: (draft: { label: string; urlTemplate: string }) => string | null;
  onRemove: (id: SearchEngineId) => void;
}) => {
  const t = useNavStrings();
  const [label, setLabel] = useState("");
  const [urlTemplate, setUrlTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const problem = onAdd({ label, urlTemplate });
    if (problem) {
      setError(problem);
      return;
    }
    setLabel("");
    setUrlTemplate("");
    setError(null);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="nav-engine-dialog">
        <DialogHeader>
          <DialogTitle>{t.addSearchEngine}</DialogTitle>
          <DialogDescription>{t.addSearchEngineHint}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-engine-label">{t.fieldEngineLabel}</Label>
            <Input
              id="nav-engine-label"
              data-testid="nav-engine-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-engine-template">{t.fieldEngineTemplate}</Label>
            <Input
              id="nav-engine-template"
              data-testid="nav-engine-template"
              value={urlTemplate}
              onChange={(e) => setUrlTemplate(e.target.value)}
              placeholder="https://example.com/search?q={q}"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="nav-engine-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" size="sm" data-testid="nav-engine-submit" disabled={customEngines.length >= MAX_CUSTOM_ENGINES}>
              {t.save}
            </Button>
          </DialogFooter>
        </form>
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">{t.customEngines}</p>
          {customEngines.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="nav-engine-custom-empty">
              {t.customEnginesEmpty}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {customEngines.map((engine) => (
                <li
                  key={engine.id}
                  className="flex items-center gap-2 rounded-md px-1 py-0.5"
                  data-testid={`nav-engine-custom-${engine.id}`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{engine.label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={`${t.removeSearchEngine}: ${engine.label}`}
                    data-testid={`nav-engine-remove-${engine.id}`}
                    onClick={() => onRemove(engine.id)}
                  >
                    <TrashIcon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const CardDialog = ({
  state,
  config,
  onClose,
  onSubmit,
}: {
  state: CardDialogState;
  config: NavConfig;
  onClose: () => void;
  onSubmit: (draft: CardDraft, groupId: string) => void;
}) => {
  const t = useNavStrings();
  const [title, setTitle] = useState(state.initial.title);
  const [url, setUrl] = useState(state.initial.url);
  const [note, setNote] = useState(state.initial.note ?? "");
  const [groupId, setGroupId] = useState(state.groupId);
  const [error, setError] = useState<string | null>(null);
  const isCreate = state.mode === "create";
  const groupOptions = config.groups.map((group) => ({ id: group.id, name: group.name }));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const draft: CardDraft = { title, url, note };
    const problem = validateCardDraft(draft, config, state.cardId);
    if (problem) {
      setError(draftErrorMessage(problem, t));
      return;
    }
    onSubmit(draft, groupId);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="nav-card-dialog">
        <DialogHeader>
          <DialogTitle>{isCreate ? t.addCard : t.editCard}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-card-title">{t.fieldTitle}</Label>
            <Input id="nav-card-title" data-testid="nav-card-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-card-url">{t.fieldUrl}</Label>
            <Input
              id="nav-card-url"
              data-testid="nav-card-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-card-note">{t.fieldNote}</Label>
            <Input id="nav-card-note" data-testid="nav-card-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {isCreate && groupOptions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldGroup}</Label>
              <Select
                value={groupId}
                items={groupOptions.map((group) => ({ value: group.id, label: group.name }))}
                onValueChange={setGroupId}
              >
                <SelectTrigger className="w-full" data-testid="nav-card-group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="nav-card-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" size="sm" data-testid="nav-card-submit">
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const NameDialog = ({ state, onClose, onSubmit }: { state: NameDialogState; onClose: () => void; onSubmit: (name: string) => void }) => {
  const t = useNavStrings();
  const [name, setName] = useState(state.initialName);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t.nameRequired);
      return;
    }
    onSubmit(name);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="nav-name-dialog">
        <DialogHeader>
          <DialogTitle>{state.mode === "create" ? t.addGroup : t.renameGroup}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-group-name">{t.fieldName}</Label>
            <Input id="nav-group-name" data-testid="nav-group-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="nav-name-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" size="sm" data-testid="nav-name-submit">
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ConfirmDialog = ({ state, onClose, onConfirm }: { state: ConfirmDialogState; onClose: () => void; onConfirm: () => void }) => {
  const t = useNavStrings();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="nav-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{state.kind === "card" ? t.deleteCard : t.deleteGroup}</DialogTitle>
          <DialogDescription>{state.kind === "card" ? t.deleteCardConfirm : t.deleteGroupConfirm}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="button" variant="destructive" size="sm" data-testid="nav-confirm-delete" onClick={onConfirm}>
            {t.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const NavigationPage = () => {
  const t = useNavStrings();
  const { state, isLoading, isError, refetch, save, isSaving } = useNavConfig();

  const [query, setQuery] = useState("");
  const [customEngines, setCustomEnginesState] = useState<SearchEngine[]>(() => readCustomEngines());
  const [engineId, setEngineIdState] = useState<SearchEngineId>(() => {
    const saved = readPreferredEngine();
    return listSearchEngines(readCustomEngines()).some((engine) => engine.id === saved) ? saved : DEFAULT_SEARCH_ENGINE;
  });
  const [engineDialogOpen, setEngineDialogOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [cardDropHint, setCardDropHint] = useState<DropHint | null>(null);
  const [groupDropHint, setGroupDropHint] = useState<number | null>(null);
  const [cardDialog, setCardDialog] = useState<CardDialogState | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [openAllConfirm, setOpenAllConfirm] = useState<{ group: NavGroup; count: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const cardRefs = useRef<Map<string, HTMLAnchorElement>>(new Map());
  const cardDragRef = useRef<CardDrag | null>(null);
  const groupDragRef = useRef<string | null>(null);

  const engines = useMemo(() => listSearchEngines(customEngines), [customEngines]);

  const setEngineId = useCallback((id: SearchEngineId) => {
    setEngineIdState(id);
    writePreferredEngine(id);
  }, []);

  const setCustomEngines = useCallback((next: SearchEngine[]) => {
    setCustomEnginesState(next);
    writeCustomEngines(next);
  }, []);

  const handleAddEngine = useCallback(
    (draft: { label: string; urlTemplate: string }): string | null => {
      const problem = validateEngineDraft(draft, customEngines.length);
      if (problem) return engineErrorMessage(problem, t);
      const engine = createCustomEngine(draft, engines);
      setCustomEngines([...customEngines, engine]);
      setEngineId(engine.id);
      return null;
    },
    [customEngines, engines, setCustomEngines, setEngineId, t],
  );

  const handleRemoveEngine = useCallback(
    (id: SearchEngineId) => {
      const next = customEngines.filter((engine) => engine.id !== id);
      setCustomEngines(next);
      if (engineId === id) setEngineId(DEFAULT_SEARCH_ENGINE);
    },
    [customEngines, engineId, setCustomEngines, setEngineId],
  );

  const openWebSearch = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const url = buildSearchUrl(getSearchEngine(engineId, customEngines), trimmed);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }, [query, engineId, customEngines]);

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

  const moveFocus = useCallback(
    (delta: number) => {
      if (flatCards.length === 0) return;
      const currentIndex = activeCardId ? flatCards.findIndex((card) => card.id === activeCardId) : -1;
      const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : flatCards.length - 1) : cycleIndex(currentIndex, delta, flatCards.length);
      const next = flatCards[nextIndex];
      setActiveCardId(next.id);
      cardRefs.current.get(next.id)?.focus();
    },
    [flatCards, activeCardId],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Ctrl+Q (or Cmd+Q avoided — it quits the browser) focuses search quickly.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "q") {
        // Cmd+Q is reserved by the browser/OS; only Ctrl+Q (and Ctrl+Q via meta on non-mac if any).
        if (event.metaKey && !event.ctrlKey) return;
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key !== "/") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const clearSearch = useCallback(() => {
    setQuery("");
    setActiveCardId(null);
  }, []);

  const handleQueryChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActiveCardId(null);
  };

  const handleSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") {
      // Tab cycles through built-in + custom engines while the spotlight is focused.
      event.preventDefault();
      setEngineId(cycleSearchEngine(engineId, event.shiftKey ? -1 : 1, customEngines).id);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      openWebSearch();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearSearch();
      event.currentTarget.blur();
    }
  };

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      clearSearch();
      searchRef.current?.focus();
    }
  };

  // Clear the roving highlight when focus leaves the card list (e.g. clicking
  // into the search box or elsewhere). `relatedTarget` stays inside the list
  // while the arrow keys hop between cards, so the highlight is preserved there.
  const handleListBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setActiveCardId(null);
    }
  };

  const toggleCollapse = (group: NavGroup) => {
    if (!state) return;
    const next: NavConfig = {
      ...state.config,
      groups: state.config.groups.map((g) => (g.id === group.id ? { ...g, collapsed: !g.collapsed } : g)),
    };
    persistQuiet(next);
  };

  const endDrag = () => {
    setDraggingCardId(null);
    setDraggingGroupId(null);
    setCardDropHint(null);
    setGroupDropHint(null);
    cardDragRef.current = null;
    groupDragRef.current = null;
  };

  const handleCardDragStart = (group: NavGroup, index: number) => (event: ReactDragEvent<HTMLAnchorElement>) => {
    cardDragRef.current = { cardId: group.items[index].id, groupId: group.id, index };
    setDraggingCardId(group.items[index].id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", group.items[index].url);
  };

  const resolveDropIndex = (event: ReactDragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY > rect.top + rect.height / 2 ? 1 : 0;
  };

  const handleCardDragOver = (group: NavGroup, index: number) => (event: ReactDragEvent<HTMLAnchorElement>) => {
    if (!cardDragRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setCardDropHint({ groupId: group.id, index: index + resolveDropIndex(event) });
  };

  const handleCardDrop = () => {
    const drag = cardDragRef.current;
    if (!drag || !state || !cardDropHint) {
      endDrag();
      return;
    }
    const next = moveCard(state.config, drag.cardId, cardDropHint.groupId, cardDropHint.index);
    persistQuiet(next);
    endDrag();
  };

  const handleEmptyGroupDragOver = (group: NavGroup) => (event: ReactDragEvent<HTMLParagraphElement>) => {
    if (!cardDragRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setCardDropHint({ groupId: group.id, index: 0 });
  };

  const handleGroupDragStart = (group: NavGroup) => (event: ReactDragEvent<HTMLButtonElement>) => {
    groupDragRef.current = group.id;
    setDraggingGroupId(group.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `nav-group:${group.id}`);
  };

  const handleGroupDragOver = (index: number) => (event: ReactDragEvent<HTMLButtonElement>) => {
    if (!groupDragRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setGroupDropHint(index + resolveDropIndex(event));
  };

  const handleGroupDrop = () => {
    const groupId = groupDragRef.current;
    if (!groupId || !state || groupDropHint === null) {
      endDrag();
      return;
    }
    const next = moveGroup(state.config, groupId, groupDropHint);
    persistQuiet(next);
    endDrag();
  };

  const openCreateCard = (groupId: string) => {
    setCardDialog({ open: true, mode: "create", groupId, initial: { title: "", url: "", note: "" } });
  };

  const [clips, setClips] = useState<NavClipItem[]>(() => readClips());
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [clipPreviews, setClipPreviews] = useState<Record<string, string>>({});

  const persistClips = useCallback((items: NavClipItem[]) => {
    setClips(items);
    writeClips(items);
    void pruneClipBlobs(items);
  }, []);

  const recordTextClip = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setClips((current) => {
      const next = addClip(trimmed, Date.now(), current);
      writeClips(next);
      return next;
    });
  }, []);

  const recordBinaryClip = useCallback(async (blob: Blob, fileName?: string) => {
    const now = Date.now();
    const current = clipsRef.current;
    let next: NavClipItem[] = current;
    if (blob.type.startsWith("image/")) {
      next = await addImageClip(blob, now, current);
    } else {
      const file =
        blob instanceof File ? blob : new File([blob], fileName || "clipboard", { type: blob.type || "application/octet-stream" });
      next = await addFileClip(file, now, current);
    }
    clipsRef.current = next;
    setClips(next);
    writeClips(next);
  }, []);

  /**
   * Pull text + images + mixed HTML from the system clipboard when the panel opens.
   * A single ClipboardItem that carries several MIME types is stored as one rich clip.
   */
  const captureSystemClipboard = useCallback(async () => {
    try {
      if (navigator.clipboard && "read" in navigator.clipboard) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const payload: Record<string, Blob | string> = {};
          let hasBinary = false;
          for (const type of item.types) {
            try {
              const blob = await item.getType(type);
              if (type === "text/plain" || type === "text/html") {
                payload[type] = await blob.text();
              } else {
                payload[type] = blob;
                hasBinary = true;
              }
            } catch {
              // Skip unreadable representations.
            }
          }
          const kinds = Object.keys(payload);
          if (kinds.length >= 2 && (payload["text/html"] || payload["text/plain"])) {
            const next = await addRichClip(payload, Date.now(), clipsRef.current);
            clipsRef.current = next;
            setClips(next);
            writeClips(next);
          } else if (hasBinary) {
            const image = kinds.find((type) => type.startsWith("image/"));
            if (image && payload[image] instanceof Blob) {
              await recordBinaryClip(payload[image] as Blob);
            } else {
              for (const type of kinds) {
                if (payload[type] instanceof File || payload[type] instanceof Blob) {
                  await recordBinaryClip(payload[type] as Blob);
                  break;
                }
              }
            }
          } else if (typeof payload["text/plain"] === "string") {
            recordTextClip(payload["text/plain"]);
          }
        }
        return;
      }
    } catch {
      // Fall through to text-only read.
    }
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) recordTextClip(text);
    } catch {
      // Permission denied or unsupported — local pastes still record.
    }
  }, [recordTextClip, recordBinaryClip]);

  // Load object URLs for image (and rich-with-image) clips currently in the list.
  // Revoke only URLs that left the map — never the ones still rendered.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const missing = clips.filter((item) => {
        if (clipPreviews[item.id]) return false;
        if (item.kind === "image") return true;
        if (item.kind === "rich") return item.parts?.some((part) => part.startsWith("image/")) ?? false;
        return false;
      });
      for (const item of missing) {
        const key = item.kind === "rich" ? clipPartKey(item.id, item.parts?.find((p) => p.startsWith("image/")) ?? "") : item.id;
        const blob = await getClipBlob(key);
        if (!blob || cancelled) continue;
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          continue;
        }
        setClipPreviews((current) => (current[item.id] ? current : { ...current, [item.id]: url }));
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [clips, clipPreviews]);

  // Drop previews for clips that were removed; revoke their object URLs.
  useEffect(() => {
    const liveIds = new Set(clips.map((item) => item.id));
    setClipPreviews((current) => {
      const next: Record<string, string> = {};
      for (const [id, url] of Object.entries(current)) {
        if (liveIds.has(id)) next[id] = url;
        else URL.revokeObjectURL(url);
      }
      return next;
    });
  }, [clips]);

  // Final unmount: revoke everything still held.
  const clipPreviewsRef = useRef(clipPreviews);
  clipPreviewsRef.current = clipPreviews;
  useEffect(
    () => () => {
      for (const url of Object.values(clipPreviewsRef.current)) URL.revokeObjectURL(url);
    },
    [],
  );

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
      setClipboardOpen(false);
      setCardDialog({ open: true, mode: "create", groupId, initial: { title, url: text, note: "" } });
      return;
    }
    setQuery(text);
    setActiveCardId(null);
    setClipboardOpen(false);
    searchRef.current?.focus();
  };

  const copyClip = async (item: NavClipItem) => {
    try {
      const payload = await buildClipWritePayload(item);
      const keys = Object.keys(payload);
      if (!keys.length) {
        toast.error(t.clipboardFailed);
        return;
      }
      const ClipboardItemCtor = window.ClipboardItem;
      if (keys.length === 1 && "text/plain" in payload) {
        await navigator.clipboard.writeText(await payload["text/plain"].text());
      } else if (ClipboardItemCtor && "write" in navigator.clipboard) {
        // Write every stored representation so paste targets keep the mixed layout.
        await navigator.clipboard.write([new ClipboardItemCtor(payload)]);
      } else {
        toast.error(t.clipboardFailed);
        return;
      }
      setCopiedId(item.id);
      window.setTimeout(() => setCopiedId((current) => (current === item.id ? null : current)), 1200);
    } catch {
      toast.error(t.clipboardFailed);
    }
  };

  const handleSearchPaste = (event: ReactClipboardEvent<HTMLInputElement>) => {
    const clipboard = event.clipboardData;
    const files = Array.from(clipboard.files);
    const html = clipboard.getData("text/html");
    const text = clipboard.getData("text");

    // Mixed rich paste (HTML markup and/or images together with text).
    if (html.trim() || files.length > 0) {
      event.preventDefault();
      // Still surface the plain text in the search box so the paste is not swallowed.
      if (text.trim()) {
        setQuery(text);
        setActiveCardId(null);
      }
      const payload: Record<string, Blob | string> = {};
      if (text) payload["text/plain"] = text;
      if (html.trim()) payload["text/html"] = html;
      for (const file of files) {
        payload[file.type || "application/octet-stream"] = file;
      }
      const hasImage = files.some((file) => file.type.startsWith("image/"));
      const isRich = Boolean(html.trim()) && (files.length > 0 || Boolean(text.trim()));
      void (async () => {
        if (isRich || (hasImage && text.trim())) {
          const next = await addRichClip(payload, Date.now(), clipsRef.current);
          clipsRef.current = next;
          setClips(next);
          writeClips(next);
          return;
        }
        if (files.length > 0) {
          await recordBinaryClip(files[0], files[0].name);
          return;
        }
        recordTextClip(text);
      })();
      return;
    }

    if (text.trim()) recordTextClip(text);
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

  const isDegraded = state?.source === "cache";

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file twice still fires change.
    event.target.value = "";
    if (!file || !state) return;
    try {
      const text = await file.text();
      const folders = parseBookmarkHtml(text);
      if (folders.length === 0) {
        toast.error(t.importEmpty);
        return;
      }
      const result = importBookmarkFolders(state.config, folders);
      if (result.addedCards === 0) {
        toast(t.importNoNew);
        return;
      }
      // Refuse up-front when the config memo would exceed the server content cap.
      const size = buildConfigContent(result.config).length;
      if (size > NAV_CONFIG_CONTENT_LIMIT) {
        toast.error(t.importTooLarge(size, NAV_CONFIG_CONTENT_LIMIT));
        return;
      }
      await persist(result.config);
      toast.success(t.importSuccess(result.addedCards, result.addedGroups, result.skippedDuplicates));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("content too long") || message.includes("invalid_argument")) {
        toast.error(t.importTooLarge(0, NAV_CONFIG_CONTENT_LIMIT));
      } else {
        toast.error(t.saveFailed);
      }
    }
  };

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

          {/* Spotlight-style search: large pill + circular scope actions. */}
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
                            onClick={() => setEngineId(engine.id)}
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
                          onClick={() => setEngineDialogOpen(true)}
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
                  onChange={handleQueryChange}
                  onPaste={handleSearchPaste}
                  onKeyDown={handleSearchKeyDown}
                  placeholder={t.searchPlaceholder}
                  aria-label={t.searchPlaceholder}
                  className="nav-spotlight-input h-12 rounded-full pr-10 pl-36 text-base"
                  data-testid="nav-search-input"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={clearSearch}
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
                      disabled={isSearching || !config || config.groups.length === 0}
                      onClick={toggleCollapseAll}
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
                      onClick={openCreateGroup}
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
                onChange={(event) => void handleImportFile(event)}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={t.importBookmarks}
                      title={t.importBookmarksHint}
                      data-testid="nav-import-button"
                      onClick={() => importInputRef.current?.click()}
                      className="nav-spotlight-action flex size-12 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    />
                  }
                >
                  <UploadIcon className="size-5" strokeWidth={1.8} />
                </TooltipTrigger>
                <TooltipContent side="bottom">{t.importBookmarks}</TooltipContent>
              </Tooltip>
              <Popover
                open={clipboardOpen}
                onOpenChange={(open) => {
                  setClipboardOpen(open);
                  if (open) void captureSystemClipboard();
                }}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <PopoverTrigger
                        render={
                          <button
                            type="button"
                            aria-label={t.clipboardHistory}
                            data-testid="nav-clipboard-add"
                            className="nav-spotlight-action flex size-12 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          />
                        }
                      />
                    }
                  >
                    <ClipboardIcon className="size-5" strokeWidth={1.8} />
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{t.clipboardHistory}</TooltipContent>
                </Tooltip>
                <PopoverContent align="end" side="bottom" className="w-80 p-2" data-testid="nav-clipboard-panel">
                  <div className="flex items-center justify-between px-1 pb-1.5 pt-0.5">
                    <span className="text-sm font-medium text-foreground">{t.clipboardHistory}</span>
                    <span className="text-[11px] text-muted-foreground">{t.clipboardHistoryHint}</span>
                  </div>
                  {clips.length === 0 ? (
                    <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t.clipboardHistoryEmpty}</p>
                  ) : (
                    <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
                      {clips.map((item) => (
                        <li key={item.id} className="group/clip flex items-start gap-1.5 rounded-md px-1.5 py-1.5 hover:bg-accent/60">
                          {item.kind === "image" || (item.kind === "rich" && item.parts?.some((part) => part.startsWith("image/"))) ? (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40">
                              {clipPreviews[item.id] ? (
                                <img src={clipPreviews[item.id]} alt="" className="size-full object-cover" />
                              ) : (
                                <ImageIcon className="size-4 text-muted-foreground" />
                              )}
                            </div>
                          ) : item.kind === "rich" ? (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                              <span className="text-[10px] font-medium text-muted-foreground">{t.clipboardRich}</span>
                            </div>
                          ) : item.kind === "file" ? (
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                              <FileIcon className="size-4 text-muted-foreground" />
                            </div>
                          ) : null}
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-start"
                            onClick={() => {
                              if (item.kind === "text") useClipText(item.text);
                            }}
                            title={item.kind === "text" ? item.text : (item.name ?? item.text)}
                          >
                            {item.kind === "text" ? (
                              <span className="line-clamp-2 break-all text-xs leading-4 text-foreground">{previewClip(item.text)}</span>
                            ) : (
                              <>
                                <span className="line-clamp-2 break-all text-xs leading-4 text-foreground">
                                  {item.kind === "rich" ? previewClip(item.text, 80) : item.name || item.mime}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {item.kind === "rich" ? t.clipboardRich : item.mime}
                                  {item.size ? ` · ${formatClipSize(item.size)}` : ""}
                                </span>
                              </>
                            )}
                          </button>
                          <div className="flex shrink-0 items-center gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={t.clipboardCopy}
                              onClick={() => void copyClip(item)}
                            >
                              {copiedId === item.id ? <CheckIcon className="size-3.5 text-primary" /> : <CopyIcon className="size-3.5" />}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={t.clipboardRemove}
                              onClick={() => persistClips(removeClip(item.id, clips))}
                            >
                              <XIcon className="size-3.5" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </PopoverContent>
              </Popover>
            </div>
          </TooltipProvider>

          {isSearching && flatCards.length === 0 ? (
            <SearchEmptyState onClear={clearSearch} />
          ) : (
            <div className="flex flex-col gap-5" onKeyDown={handleListKeyDown} onBlur={handleListBlur}>
              {filtered?.groups.map((group, groupIndex) => (
                <div key={group.id} className="flex flex-col gap-3" data-testid="nav-group">
                  <div className="flex items-center gap-1.5 self-start">
                    <button
                      type="button"
                      draggable={canDrag}
                      onDragStart={handleGroupDragStart(group)}
                      onDragOver={handleGroupDragOver(groupIndex)}
                      onDrop={handleGroupDrop}
                      onDragEnd={endDrag}
                      data-dragging={draggingGroupId === group.id ? "true" : undefined}
                      data-drop-before={groupDropHint === groupIndex ? "true" : undefined}
                      data-drop-after={groupDropHint === groupIndex + 1 ? "true" : undefined}
                      className={`nav-page-group group flex items-center gap-1.5 rounded-full px-2.5 py-1 text-foreground ${canDrag ? "cursor-grab" : ""}`}
                      onClick={() => toggleCollapse(group)}
                      aria-expanded={!group.collapsed}
                    >
                      {canDrag ? (
                        <GripVerticalIcon className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground" />
                      ) : null}
                      {group.collapsed ? (
                        <ChevronRightIcon className="size-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium leading-none">{group.name}</span>
                      <span className="nav-page-count flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium leading-5">
                        {group.items.length}
                      </span>
                      <span className="sr-only">{group.collapsed ? t.expand : t.collapse}</span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t.openAllLinks}
                      title={t.openAllLinks}
                      data-testid="nav-open-all"
                      disabled={group.items.length === 0}
                      onClick={() => requestOpenAll(group)}
                    >
                      <SquareArrowOutUpRightIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t.addCard}
                      data-testid="nav-add-card"
                      onClick={() => openCreateCard(group.id)}
                    >
                      <PlusIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t.renameGroup}
                      data-testid="nav-rename-group"
                      onClick={() => openRenameGroup(group)}
                    >
                      <PencilIcon className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t.deleteGroup}
                      data-testid="nav-delete-group"
                      onClick={() => openDeleteGroup(group)}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </div>

                  {!group.collapsed ? (
                    group.items.length === 0 ? (
                      <p
                        className="border-border rounded-xl border border-dashed p-4 text-sm text-muted-foreground"
                        onDragOver={handleEmptyGroupDragOver(group)}
                        onDrop={handleCardDrop}
                        onDragEnd={endDrag}
                      >
                        {t.emptyGroup}
                      </p>
                    ) : (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {group.items.map((card, index) => (
                          <Card
                            key={card.id}
                            card={card}
                            active={card.id === activeCardId}
                            dropBefore={cardDropHint?.groupId === group.id && cardDropHint.index === index}
                            dropAfter={cardDropHint?.groupId === group.id && cardDropHint.index === index + 1}
                            dragDisabled={!canDrag}
                            dragging={draggingCardId === card.id}
                            onFocus={() => setActiveCardId(card.id)}
                            onEdit={() => openEditCard(group, card)}
                            onDelete={() => openDeleteCard(group, card)}
                            cardRef={(el) => {
                              if (el) cardRefs.current.set(card.id, el);
                              else cardRefs.current.delete(card.id);
                            }}
                            onDragStartCard={handleCardDragStart(group, index)}
                            onDragOverCard={handleCardDragOver(group, index)}
                            onDropCard={handleCardDrop}
                            onDragEndCard={endDrag}
                          />
                        ))}
                      </div>
                    )
                  ) : null}
                </div>
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
        <Dialog open onOpenChange={(open) => (open ? undefined : setOpenAllConfirm(null))}>
          <DialogContent size="sm" data-testid="nav-open-all-dialog">
            <DialogHeader>
              <DialogTitle>{t.openAllLinksTitle}</DialogTitle>
              <DialogDescription>{t.openAllLinksConfirm(openAllConfirm.count)}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setOpenAllConfirm(null)}>
                {t.cancel}
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="nav-open-all-confirm"
                onClick={() => {
                  const group = openAllConfirm.group;
                  setOpenAllConfirm(null);
                  void runOpenAll(group);
                }}
              >
                {t.confirm}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
};

export default NavigationPage;
