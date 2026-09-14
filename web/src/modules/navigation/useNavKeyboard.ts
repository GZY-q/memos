import type { FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { useCallback, useEffect } from "react";
import { cycleIndex, type flattenCards } from "./search";
import { cycleSearchEngine, type SearchEngine, type SearchEngineId } from "./searchEngines";

type FlatCard = ReturnType<typeof flattenCards>[number];

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null);

/**
 * Spotlight keyboard: `/` and Ctrl+Q focus the search box; arrows move a roving
 * highlight across matched cards; Tab cycles engines; Escape clears.
 */
export function useNavKeyboard({
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
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  flatCards: FlatCard[];
  activeCardId: string | null;
  setActiveCardId: (id: string | null) => void;
  cardRefs: RefObject<Map<string, HTMLAnchorElement>>;
  engineId: SearchEngineId;
  customEngines: SearchEngine[];
  setEngineId: (id: SearchEngineId) => void;
  openWebSearch: () => void;
  setQuery: (query: string) => void;
}) {
  const clearSearch = useCallback(() => {
    setQuery("");
    setActiveCardId(null);
  }, [setQuery, setActiveCardId]);

  const moveFocus = useCallback(
    (delta: number) => {
      if (flatCards.length === 0) return;
      const currentIndex = activeCardId ? flatCards.findIndex((card) => card.id === activeCardId) : -1;
      const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : flatCards.length - 1) : cycleIndex(currentIndex, delta, flatCards.length);
      const next = flatCards[nextIndex];
      setActiveCardId(next.id);
      cardRefs.current.get(next.id)?.focus();
    },
    [flatCards, activeCardId, setActiveCardId, cardRefs],
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
  }, [searchRef]);

  const handleSearchKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
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
    },
    [engineId, customEngines, setEngineId, openWebSearch, moveFocus, clearSearch],
  );

  const handleListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
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
    },
    [moveFocus, clearSearch, searchRef],
  );

  // Clear the roving highlight when focus leaves the card list (e.g. clicking
  // into the search box or elsewhere). `relatedTarget` stays inside the list
  // while the arrow keys hop between cards, so the highlight is preserved there.
  const handleListBlur = useCallback(
    (event: ReactFocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
        setActiveCardId(null);
      }
    },
    [setActiveCardId],
  );

  return { clearSearch, moveFocus, handleSearchKeyDown, handleListKeyDown, handleListBlur };
}
