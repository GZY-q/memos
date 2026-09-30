import { type ComponentType, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { loadMemoEditor } from "./loader";
import type { MemoEditorProps } from "./types";

// Renders a placeholder matching the editor's collapsed shape while the real
// editor chunk (CodeMirror, toolbar, services) downloads in parallel. This
// keeps editor-vendor out of the first-paint critical path on pages that mount
// an editor immediately (Home, Journal), instead of statically importing it.
const LazyMemoEditor = (props: MemoEditorProps) => {
  const [EditorComponent, setEditorComponent] = useState<ComponentType<MemoEditorProps>>();

  useEffect(() => {
    let cancelled = false;
    loadMemoEditor()
      .then(({ default: MemoEditor }) => {
        if (!cancelled) {
          setEditorComponent(() => MemoEditor);
        }
      })
      .catch(() => {
        // Chunk failures are handled by loadWithReload; keep the placeholder mounted.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!EditorComponent) {
    return (
      <div aria-hidden className={cn("w-full min-h-[120px] bg-card rounded-lg border border-border animate-pulse", props.className)} />
    );
  }

  return <EditorComponent {...props} />;
};

export default LazyMemoEditor;
