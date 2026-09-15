import { CheckIcon, CornerDownLeftIcon, LoaderIcon, SparklesIcon, WifiOffIcon } from "lucide-react";
import type { FC } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { cn } from "@/lib/utils";
import type { Location, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { primaryModifierGlyph } from "@/utils/platform";
import { validationService } from "../services";
import { useEditorContext, useEditorSelector } from "../state";
import type { EditorToolbarProps } from "../types";
import InsertMenu from "./InsertMenu";
import VisibilitySelector from "./VisibilitySelector";

/**
 * Shortcut chip inside the commit button. While saving, a spinner takes the
 * chip's place; both layers share one grid cell so the button keeps its width
 * across the swap. Hidden on coarse pointers, where there is no keyboard to hint.
 */
const ShortcutChip: FC<{ busy: boolean }> = ({ busy }) => (
  <kbd
    aria-hidden
    className="grid place-items-center rounded-[4px] bg-primary-foreground/20 px-1 py-0.5 font-sans text-[11px] leading-none font-medium pointer-coarse:hidden"
  >
    <span className={cn("col-start-1 row-start-1 inline-flex items-center gap-px", busy && "invisible")}>
      {primaryModifierGlyph()}
      <CornerDownLeftIcon className="size-2.5" strokeWidth={2.5} />
    </span>
    <LoaderIcon className={cn("col-start-1 row-start-1 size-2.5 animate-spin", !busy && "invisible")} strokeWidth={3} />
  </kbd>
);

export const EditorToolbar: FC<EditorToolbarProps> = ({
  onSave,
  onCancel,
  memoName,
  parentMemoName,
  space,
  onAudioRecorderClick,
  onWritingClick,
  writingDisabled,
  viewToggles,
  onInsertImages,
}) => {
  const t = useTranslate();
  const { actions, dispatch } = useEditorContext();
  const isOnline = useOnlineStatus();
  // Subscribe to narrow/derived slices so typing (which only changes content)
  // doesn't re-render the toolbar or the heavy InsertMenu it hosts. `valid`
  // flips only on empty↔non-empty / loading transitions, not per keystroke.
  const valid = useEditorSelector((s) => validationService.canSave(s).valid);
  const blockedReason = useEditorSelector((s) => validationService.canSave(s).reason);
  const blockedReasonDetail = useEditorSelector((s) => validationService.canSave(s).detail);
  const isSaving = useEditorSelector((s) => s.ui.isLoading.saving);
  const justSaved = useEditorSelector((s) => s.ui.justSaved);
  const isUploading = useEditorSelector((s) => s.ui.isLoading.uploading);
  const location = useEditorSelector((s) => s.metadata.location);
  const visibility = useEditorSelector((s) => s.metadata.visibility);
  // The save transaction is in flight or its confirmation is holding the
  // editor open; either way the toolbar is frozen.
  const committing = isSaving || justSaved;
  const blockedMessage =
    valid || committing
      ? undefined
      : blockedReason
        ? t(blockedReason, blockedReasonDetail ? { url: blockedReasonDetail } : undefined)
        : t("editor.validation.cannot-save");
  // The verb names what the host does with the memo: an existing memo is
  // updated, a reply becomes a comment, and a new memo is simply saved. A memo
  // is stored with a visibility, not posted, so messaging verbs stay out.
  const commitLabel = memoName ? t("common.update") : parentMemoName ? t("editor.comment") : t("editor.save");

  const handleLocationChange = (next?: Location) => {
    dispatch(actions.setMetadata({ location: next }));
  };

  const handleVisibilityChange = (next: Visibility) => {
    dispatch(actions.setMetadata({ visibility: next }));
  };

  const commitButton = justSaved ? (
    <Button disabled>
      {t("editor.saved")}
      <CheckIcon className="size-3.5" strokeWidth={2.5} />
    </Button>
  ) : (
    <Button onClick={onSave} disabled={isSaving || !valid}>
      {commitLabel}
      <ShortcutChip busy={isSaving} />
    </Button>
  );

  return (
    <div className="w-full flex flex-row justify-between items-center mb-2">
      <div className="flex flex-row justify-start items-center gap-1">
        <InsertMenu
          isUploading={isUploading}
          isSaving={committing}
          location={location}
          onLocationChange={handleLocationChange}
          memoName={memoName}
          onAudioRecorderClick={onAudioRecorderClick}
          viewToggles={viewToggles}
          onInsertImages={onInsertImages}
        />
        {onWritingClick && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="secondary"
                  size="icon"
                  aria-label={t("editor.writing.title")}
                  disabled={committing || writingDisabled}
                  onClick={onWritingClick}
                />
              }
            >
              <SparklesIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t("editor.writing.title")}</TooltipContent>
          </Tooltip>
        )}
        <VisibilitySelector value={visibility} space={space} onChange={handleVisibilityChange} />
        {!isOnline && (
          <span
            data-testid="editor-offline-badge"
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300"
            title={t("editor.offline-badge")}
          >
            <WifiOffIcon className="size-3" />
            {t("editor.offline-badge")}
          </span>
        )}
      </div>

      <div className="flex flex-row justify-end items-center gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel} disabled={committing}>
            {t("common.cancel")}
          </Button>
        )}

        {blockedMessage ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" tabIndex={0} aria-label={blockedMessage} />}>
              {commitButton}
            </TooltipTrigger>
            <TooltipContent side="top">{blockedMessage}</TooltipContent>
          </Tooltip>
        ) : (
          commitButton
        )}
      </div>
    </div>
  );
};
