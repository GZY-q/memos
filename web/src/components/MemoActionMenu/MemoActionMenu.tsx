import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  BookmarkMinusIcon,
  BookmarkPlusIcon,
  CheckCheckIcon,
  CopyIcon,
  Edit3Icon,
  FileTextIcon,
  FolderInputIcon,
  LinkIcon,
  ListChecksIcon,
  ListRestartIcon,
  MoreHorizontalIcon,
  MoreVerticalIcon,
  TrashIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { errorService } from "@/components/MemoEditor/services";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useInstanceSetting } from "@/hooks/useInstanceQueries";
import { useTTSPlayer } from "@/hooks/useTTSPlayer";
import { State } from "@/types/proto/api/v1/common_pb";
import { InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import { useMemoActionHandlers } from "./hooks";
import MemoMoveDialog from "./MemoMoveDialog";
import type { MemoActionMenuProps } from "./types";

const MemoActionMenu = (props: MemoActionMenuProps) => {
  const { memo, readonly } = props;
  const t = useTranslate();

  // Dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);

  // Derived state
  const isComment = Boolean(memo.parent);
  const isArchived = memo.state === State.ARCHIVED;
  const canMutateTasks = !readonly && !isArchived && Boolean(memo.property?.hasTaskList);
  const hasOpenTasks = Boolean(memo.property?.hasIncompleteTasks);

  // Action handlers
  const {
    canMove,
    handleTogglePinMemoBtnClick,
    handleEditMemoClick,
    handleToggleMemoStatusClick,
    handleCopyLink,
    handleCopyContent,
    handleCheckAllTaskListItemsClick,
    handleUncheckAllTaskListItemsClick,
    handleDeleteMemoClick,
    confirmDeleteMemo,
  } = useMemoActionHandlers({
    memo,
    parentPage: props.parentPage,
    onEdit: props.onEdit,
    setDeleteDialogOpen,
  });

  // Text-to-speech (Volcengine Ark Agent Plan when configured).
  const { data: aiSetting } = useInstanceSetting(InstanceSetting_Key.AI);
  const ttsConfigured = Boolean(aiSetting?.value.case === "aiSetting" && aiSetting.value.value.tts?.providerId);
  const { isSpeakingThisMemo, isBusy, play: playTTS, stop: stopTTS } = useTTSPlayer(memo.name);

  const handleReadAloud = async () => {
    if (isSpeakingThisMemo || isBusy) {
      stopTTS();
      return;
    }
    try {
      await playTTS(memo.content);
    } catch (error) {
      if ((error as Error).message === "empty") {
        toast.error(t("memo.tts-empty"));
        return;
      }
      toast.error(errorService.getErrorMessage(error) || t("memo.tts-error"));
    }
  };

  const readAloudLabel = isSpeakingThisMemo ? t("memo.tts-stop") : t("memo.read-aloud");
  const readAloudIcon = isSpeakingThisMemo ? <VolumeXIcon className="w-4 h-auto" /> : <Volume2Icon className="w-4 h-auto" />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="quiet" size="icon-sm" aria-label={t("common.more")} />}>
        <MoreVerticalIcon className="size-4" strokeWidth={1.8} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={2}>
        {/* Edit actions (non-readonly, non-archived) */}
        {!readonly && !isArchived && (
          <>
            {!isComment && (
              <DropdownMenuItem onClick={handleTogglePinMemoBtnClick}>
                {memo.pinned ? <BookmarkMinusIcon className="w-4 h-auto" /> : <BookmarkPlusIcon className="w-4 h-auto" />}
                {memo.pinned ? t("common.unpin") : t("common.pin")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={handleEditMemoClick}>
              <Edit3Icon className="w-4 h-auto" />
              {t("common.edit")}
            </DropdownMenuItem>
          </>
        )}

        {/* Copy submenu (non-archived) */}
        {!isArchived && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <CopyIcon className="w-4 h-auto" />
              {t("common.copy")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onClick={handleCopyLink}>
                <LinkIcon className="w-4 h-auto" />
                {t("memo.copy-link")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyContent}>
                <FileTextIcon className="w-4 h-auto" />
                {t("memo.copy-content")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Text-to-speech (when configured) */}
        {ttsConfigured && !isArchived && (
          <DropdownMenuItem onClick={handleReadAloud}>
            {readAloudIcon}
            {readAloudLabel}
          </DropdownMenuItem>
        )}

        {/* Task submenu (writable task memos) */}
        {canMutateTasks && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ListChecksIcon className="w-4 h-auto" />
              {t("memo.task-actions.title")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem disabled={!hasOpenTasks} onClick={handleCheckAllTaskListItemsClick}>
                <CheckCheckIcon className="w-4 h-auto" />
                {t("memo.task-actions.check-all")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleUncheckAllTaskListItemsClick}>
                <ListRestartIcon className="w-4 h-auto" />
                {t("memo.task-actions.uncheck-all")}
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {!readonly && !isComment && (
          <DropdownMenuItem onClick={handleToggleMemoStatusClick}>
            {isArchived ? <ArchiveRestoreIcon className="w-4 h-auto" /> : <ArchiveIcon className="w-4 h-auto" />}
            {isArchived ? t("common.restore") : t("common.archive")}
          </DropdownMenuItem>
        )}

        {(canMove || !readonly) && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <MoreHorizontalIcon className="size-4" />
              {t("common.more")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {canMove && (
                <DropdownMenuItem onClick={() => setMoveDialogOpen(true)}>
                  <FolderInputIcon className="size-4" />
                  {t("memo.move.title")}
                </DropdownMenuItem>
              )}
              {!readonly && (
                <DropdownMenuItem onClick={handleDeleteMemoClick}>
                  <TrashIcon className="size-4" />
                  {t("common.delete")}
                </DropdownMenuItem>
              )}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>

      {moveDialogOpen && <MemoMoveDialog memo={memo} onOpenChange={setMoveDialogOpen} />}

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={t("memo.delete-confirm")}
        confirmLabel={t("common.delete")}
        description={t("memo.delete-confirm-description")}
        cancelLabel={t("common.cancel")}
        onConfirm={confirmDeleteMemo}
        confirmVariant="destructive"
      />
    </DropdownMenu>
  );
};

export default MemoActionMenu;
