import { CheckIcon, ClipboardIcon, CopyIcon, FileIcon, ImageIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatClipSize, type NavClipItem, previewClip } from "./clipboard";
import { useNavStrings } from "./i18n";

export const ClipboardPanel = ({
  open,
  onOpenChange,
  clips,
  clipPreviews,
  copiedId,
  onUseText,
  onCopy,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clips: NavClipItem[];
  clipPreviews: Record<string, string>;
  copiedId: string | null;
  onUseText: (text: string) => void;
  onCopy: (item: NavClipItem) => void;
  onRemove: (item: NavClipItem) => void;
}) => {
  const t = useNavStrings();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
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
                    if (item.kind === "text") onUseText(item.text);
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
                    onClick={() => onCopy(item)}
                  >
                    {copiedId === item.id ? <CheckIcon className="size-3.5 text-primary" /> : <CopyIcon className="size-3.5" />}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t.clipboardRemove}
                    onClick={() => onRemove(item)}
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
  );
};
