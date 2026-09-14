import type { ClipboardEvent as ReactClipboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import {
  addClip,
  addFileClip,
  addImageClip,
  addRichClip,
  buildClipWritePayload,
  clipPartKey,
  getClipBlob,
  type NavClipItem,
  pruneClipBlobs,
  readClips,
  removeClip,
  writeClips,
} from "./clipboard";
import { useNavStrings } from "./i18n";

/**
 * Clipboard history: local list + system capture on panel open, object-URL
 * previews for images, and paste-to-search / paste-as-card routing.
 */
export function useNavClipboard({
  setQuery,
  setActiveCardId,
}: {
  setQuery: (query: string) => void;
  setActiveCardId: (id: string | null) => void;
}) {
  const t = useNavStrings();
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

  const copyClip = useCallback(
    async (item: NavClipItem) => {
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
    },
    [t.clipboardFailed],
  );

  const handleSearchPaste = useCallback(
    (event: ReactClipboardEvent<HTMLInputElement>) => {
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
    },
    [setQuery, setActiveCardId, recordBinaryClip, recordTextClip],
  );

  return {
    clips,
    clipboardOpen,
    setClipboardOpen,
    copiedId,
    clipPreviews,
    persistClips,
    recordTextClip,
    recordBinaryClip,
    captureSystemClipboard,
    copyClip,
    handleSearchPaste,
    removeClipFromList: (id: string) => persistClips(removeClip(id, clips)),
  };
}
