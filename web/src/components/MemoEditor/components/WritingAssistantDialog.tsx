import { LoaderIcon, SparklesIcon } from "lucide-react";
import type { FC } from "react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { errorService, writingService } from "../services";
import type { EditorController } from "../types/editorController";

const SOURCE_PREVIEW_LIMIT = 400;

type AssistantMode = "rewrite" | "generate";

type RewriteAction = {
  id: string;
  labelKey:
    | "editor.writing.action-polish"
    | "editor.writing.action-fix"
    | "editor.writing.action-continue"
    | "editor.writing.action-summarize"
    | "editor.writing.action-expand";
  promptKey:
    | "editor.writing.prompt-polish"
    | "editor.writing.prompt-fix"
    | "editor.writing.prompt-continue"
    | "editor.writing.prompt-summarize"
    | "editor.writing.prompt-expand";
};

const REWRITE_ACTIONS: RewriteAction[] = [
  { id: "polish", labelKey: "editor.writing.action-polish", promptKey: "editor.writing.prompt-polish" },
  { id: "fix", labelKey: "editor.writing.action-fix", promptKey: "editor.writing.prompt-fix" },
  { id: "continue", labelKey: "editor.writing.action-continue", promptKey: "editor.writing.prompt-continue" },
  { id: "summarize", labelKey: "editor.writing.action-summarize", promptKey: "editor.writing.prompt-summarize" },
  { id: "expand", labelKey: "editor.writing.action-expand", promptKey: "editor.writing.prompt-expand" },
];

export interface WritingAssistantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editorRef: React.RefObject<EditorController | null>;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Writing assistant with two modes:
 * - rewrite: transform the selection / draft with an instruction
 * - generate: produce new content from an instruction alone (no source text)
 *
 * The instance supplies the OpenAI-compatible endpoint and system prompt.
 */
export const WritingAssistantDialog: FC<WritingAssistantDialogProps> = ({ open, onOpenChange, editorRef, disabled, disabledReason }) => {
  const t = useTranslate();
  const [mode, setMode] = useState<AssistantMode>("rewrite");
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const source = useMemo(() => {
    if (!open) return { text: "", mode: "draft" as const };
    const editor = editorRef.current;
    if (!editor) return { text: "", mode: "draft" as const };
    const selection = editor.getSelection().text;
    if (selection.trim()) {
      return { text: selection, mode: "selection" as const };
    }
    return { text: editor.getMarkdown(), mode: "draft" as const };
  }, [open, editorRef]);

  const sourcePreview = useMemo(() => {
    const text = source.text.trim();
    if (!text) return t("editor.writing.source-empty");
    if (text.length <= SOURCE_PREVIEW_LIMIT) return text;
    return `${text.slice(0, SOURCE_PREVIEW_LIMIT)}…`;
  }, [source.text, t]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setMode("rewrite");
        setInstruction("");
        setResult("");
        setIsGenerating(false);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  const handleGenerate = useCallback(
    async (prompt: string, options?: { ignoreSource?: boolean }) => {
      const trimmed = prompt.trim();
      if (!trimmed) {
        toast.error(t("editor.writing.instruction-required"));
        return;
      }
      // Generate mode sends no source text — the model writes from the instruction alone.
      const content = options?.ignoreSource ? "" : source.text.trim();
      setIsGenerating(true);
      try {
        const text = (await writingService.complete(trimmed, content)).trim();
        if (!text) {
          toast.error(t("editor.writing.empty-result"));
          return;
        }
        setResult(text);
      } catch (error) {
        console.error(error);
        toast.error(errorService.getErrorMessage(error) || t("editor.writing.generate-error"));
      } finally {
        setIsGenerating(false);
      }
    },
    [source.text, t],
  );

  const handleRewriteAction = useCallback(
    (action: RewriteAction) => {
      const prompt = t(action.promptKey);
      setInstruction(prompt);
      void handleGenerate(prompt);
    },
    [handleGenerate, t],
  );

  const handleRun = useCallback(() => {
    void handleGenerate(instruction, { ignoreSource: mode === "generate" });
  }, [handleGenerate, instruction, mode]);

  const applyResult = useCallback(
    (target: "replace" | "append") => {
      const editor = editorRef.current;
      if (!editor || !result) return;

      if (target === "append") {
        const existing = editor.getMarkdown();
        const separator = existing && !existing.endsWith("\n") ? "\n\n" : existing ? "\n\n" : "";
        editor.setMarkdown(existing + separator + result);
      } else if (mode === "rewrite" && source.mode === "selection") {
        // CodeMirror keeps the selection across blur, so replaceSelection hits
        // the original span the rewrite was based on.
        editor.replaceSelection(result);
      } else {
        editor.setMarkdown(result);
      }
      editor.scrollToCursor();
      handleClose(false);
    },
    [editorRef, handleClose, mode, result, source.mode],
  );

  const replaceLabel =
    mode === "generate"
      ? t("editor.writing.replace-draft")
      : source.mode === "selection"
        ? t("editor.writing.replace-selection")
        : t("editor.writing.replace-draft");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle className="inline-flex items-center gap-2">
            <SparklesIcon className="size-4" />
            {t("editor.writing.title")}
          </DialogTitle>
          <DialogDescription>{disabled && disabledReason ? disabledReason : t("editor.writing.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Mode switch: rewrite existing text vs generate from scratch. */}
          <div className="inline-flex w-fit rounded-md border bg-muted/40 p-0.5">
            <Button
              variant={mode === "rewrite" ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-7 px-3", mode === "rewrite" && "shadow-sm")}
              disabled={disabled || isGenerating}
              onClick={() => setMode("rewrite")}
            >
              {t("editor.writing.mode-rewrite")}
            </Button>
            <Button
              variant={mode === "generate" ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-7 px-3", mode === "generate" && "shadow-sm")}
              disabled={disabled || isGenerating}
              onClick={() => setMode("generate")}
            >
              {t("editor.writing.mode-generate")}
            </Button>
          </div>

          {mode === "rewrite" && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{t("editor.writing.source")}</span>
                <span className="text-xs text-muted-foreground">
                  {source.mode === "selection" ? t("editor.writing.source-selection") : t("editor.writing.source-draft")}
                </span>
              </div>
              <div className="max-h-28 overflow-y-auto rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground whitespace-pre-wrap">
                {sourcePreview}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              {mode === "generate" ? t("editor.writing.generate-prompt") : t("editor.writing.instruction")}
            </span>
            {mode === "rewrite" && (
              <div className="flex flex-wrap gap-1.5">
                {REWRITE_ACTIONS.map((action) => (
                  <Button
                    key={action.id}
                    variant="outline"
                    size="sm"
                    disabled={disabled || isGenerating}
                    onClick={() => handleRewriteAction(action)}
                  >
                    {t(action.labelKey)}
                  </Button>
                ))}
              </div>
            )}
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={mode === "generate" ? t("editor.writing.generate-placeholder") : t("editor.writing.instruction-placeholder")}
              rows={mode === "generate" ? 4 : 3}
              disabled={disabled || isGenerating}
              maxLength={4000}
            />
            {mode === "generate" && <p className="text-xs text-muted-foreground">{t("editor.writing.generate-help")}</p>}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("editor.writing.result")}</span>
            <Textarea
              value={result}
              onChange={(e) => setResult(e.target.value)}
              placeholder={t("editor.writing.result-placeholder")}
              rows={8}
              disabled={disabled || isGenerating}
              maxLength={20000}
            />
          </div>
        </div>

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="ghost" onClick={() => handleClose(false)} disabled={isGenerating}>
            {t("common.cancel")}
          </Button>
          <Button variant="secondary" onClick={handleRun} disabled={disabled || isGenerating}>
            {isGenerating ? (
              <>
                <LoaderIcon className="size-3.5 animate-spin" />
                {t("editor.writing.generating")}
              </>
            ) : mode === "generate" ? (
              t("editor.writing.generate-from-scratch")
            ) : (
              t("editor.writing.generate")
            )}
          </Button>
          <Button variant="secondary" onClick={() => applyResult("append")} disabled={disabled || isGenerating || !result}>
            {t("editor.writing.insert-at-end")}
          </Button>
          <Button onClick={() => applyResult("replace")} disabled={disabled || isGenerating || !result}>
            {replaceLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default WritingAssistantDialog;
