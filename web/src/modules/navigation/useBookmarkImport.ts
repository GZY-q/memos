import type { ChangeEvent, RefObject } from "react";
import { toast } from "react-hot-toast";
import { importBookmarkFolders, parseBookmarkHtml } from "./bookmarks";
import { useNavStrings } from "./i18n";
import { buildConfigContent } from "./storage";
import { NAV_CONFIG_CONTENT_LIMIT, type NavConfig } from "./types";

/** Parse a browser bookmark HTML export and merge it into the config. */
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

  return {
    importInputRef,
    handleImportFile,
    openImportPicker: () => importInputRef.current?.click(),
  };
}
