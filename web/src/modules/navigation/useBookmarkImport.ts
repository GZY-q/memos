import type { ChangeEvent, RefObject } from "react";
import { toast } from "react-hot-toast";
import { importBookmarkFolders, parseBookmarkHtml } from "./bookmarks";
import { useNavStrings } from "./i18n";
import { buildConfigContent } from "./storage";
import { NAV_CONFIG_LOCAL_SOFT_LIMIT, NAV_CONFIG_MEMO_CONTENT_LIMIT, type NavConfig } from "./types";

/**
 * Parse a browser bookmark HTML export and merge it into the config.
 *
 * Large imports are allowed: the local store is the primary persistence and
 * has a multi-MB quota. The memo backup is skipped by the persist path when
 * the body exceeds the server content cap, and the page surfaces that as a
 * local-only note.
 */
export function useBookmarkImport({
  state,
  persist,
  importInputRef,
}: {
  state: { config: NavConfig } | null;
  persist: (next: NavConfig) => Promise<void>;
  importInputRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useNavStrings();

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
      // Soft ceiling only — beyond this the browser itself will struggle.
      const size = buildConfigContent(result.config).length;
      if (size > NAV_CONFIG_LOCAL_SOFT_LIMIT) {
        toast.error(t.importTooLarge(size, NAV_CONFIG_LOCAL_SOFT_LIMIT));
        return;
      }
      await persist(result.config);
      const skippedBackup = size > NAV_CONFIG_MEMO_CONTENT_LIMIT;
      toast.success(t.importSuccess(result.addedCards, result.addedGroups, result.skippedDuplicates));
      if (skippedBackup) toast(t.localOnlyNote);
    } catch {
      toast.error(t.saveFailed);
    }
  };

  return {
    importInputRef,
    handleImportFile,
    openImportPicker: () => importInputRef.current?.click(),
  };
}
