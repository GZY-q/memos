import { ListPlusIcon, Volume2Icon, VolumeXIcon } from "lucide-react";
import { toast } from "react-hot-toast";
import { errorService } from "@/components/MemoEditor/services";
import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useInstanceSetting } from "@/hooks/useInstanceQueries";
import { useTTSPlayer } from "@/hooks/useTTSPlayer";
import { cn } from "@/lib/utils";
import { InstanceSetting_Key } from "@/types/proto/api/v1/instance_service_pb";
import { useTranslate } from "@/utils/i18n";

interface MemoReadAloudButtonProps {
  memoName: string;
  content: string;
  className?: string;
}

/**
 * Quick-access read-aloud control placed next to the reaction button on memo cards.
 *
 * Clicking while another memo is playing enqueues this one instead of interrupting,
 * so a short listening queue can be built from the timeline.
 */
const MemoReadAloudButton = ({ memoName, content, className }: MemoReadAloudButtonProps) => {
  const t = useTranslate();
  const { data: aiSetting } = useInstanceSetting(InstanceSetting_Key.AI);
  const ttsConfigured = Boolean(aiSetting?.value.case === "aiSetting" && aiSetting.value.value.tts?.providerId);
  const { isSpeakingThisMemo, isBusy, play, stop, enqueuePlay } = useTTSPlayer(memoName);

  if (!ttsConfigured) {
    return null;
  }

  const isQueuedAction = isBusy && !isSpeakingThisMemo;

  const handleClick = async () => {
    if (isSpeakingThisMemo) {
      stop();
      return;
    }
    try {
      if (isQueuedAction) {
        await enqueuePlay(content);
        toast.success(t("memo.tts-queued"));
        return;
      }
      await play(content);
    } catch (error) {
      if ((error as Error).message === "empty") {
        toast.error(t("memo.tts-empty"));
        return;
      }
      toast.error(errorService.getErrorMessage(error) || t("memo.tts-error"));
    }
  };

  const label = isSpeakingThisMemo ? t("memo.tts-stop") : isQueuedAction ? t("memo.tts-enqueue") : t("memo.read-aloud");

  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={label}
        className={cn(
          buttonVariants({ variant: "quiet", size: "icon-sm" }),
          // Same reveal pattern as the reaction control: always on mobile,
          // hover/focus-within on desktop; keep visible while speaking.
          "flex sm:hidden sm:group-hover:flex sm:group-focus-within:flex",
          isSpeakingThisMemo && "sm:flex!",
          className,
        )}
        onClick={handleClick}
      >
        {isSpeakingThisMemo ? (
          <VolumeXIcon className="size-4" strokeWidth={1.8} />
        ) : isQueuedAction ? (
          <ListPlusIcon className="size-4" strokeWidth={1.8} />
        ) : (
          <Volume2Icon className="size-4" strokeWidth={1.8} />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

export default MemoReadAloudButton;
