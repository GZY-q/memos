import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { UploadIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { memoServiceClient } from "@/connect";
import { useSpaceContext } from "@/contexts/SpaceContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { handleError } from "@/lib/error";
import { ImportError, type ImportedMemo, parseImportFile } from "@/lib/import";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";

type ImportPhase = "idle" | "parsing" | "importing" | "done";

interface ImportProgress {
  total: number;
  completed: number;
  failed: number;
}

/** Sequential batch create: keeps rate limits happy and makes progress meaningful. */
const importMemos = async (
  memos: ImportedMemo[],
  options: { space?: string; visibility: Visibility; onProgress: (progress: ImportProgress) => void },
): Promise<{ created: number; failed: number; errors: string[] }> => {
  let created = 0;
  let failed = 0;
  const errors: string[] = [];
  const total = memos.length;

  for (const [index, item] of memos.entries()) {
    try {
      await memoServiceClient.createMemo({
        memo: create(MemoSchema, {
          content: item.content,
          visibility: options.visibility,
          space: options.space,
          createTime: item.createTime ? timestampFromDate(item.createTime) : undefined,
        }),
      });
      created += 1;
    } catch (error) {
      failed += 1;
      if (errors.length < 5) {
        errors.push(`${item.source}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    options.onProgress({ total, completed: index + 1, failed });
  }

  return { created, failed, errors };
};

const ImportSection = () => {
  const t = useTranslate();
  const user = useCurrentUser();
  const { selectedSpaceName } = useSpaceContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [fileName, setFileName] = useState<string>();
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  const handleFileSelected = useCallback(
    async (file: File) => {
      if (!user) return;
      setFileName(file.name);
      setWarnings([]);
      setError(undefined);
      setProgress(null);
      setPhase("parsing");

      try {
        const parsed = await parseImportFile(file);
        setWarnings(parsed.warnings.slice(0, 8));
        setPhase("importing");
        setProgress({ total: parsed.memos.length, completed: 0, failed: 0 });
        const result = await importMemos(parsed.memos, {
          space: selectedSpaceName,
          // Imports land as private notes; visibility can be changed per memo afterwards.
          visibility: Visibility.PRIVATE,
          onProgress: setProgress,
        });
        setPhase("done");
        if (result.failed === 0) {
          toast.success(t("setting.import.success", { count: result.created }));
        } else {
          toast.error(t("setting.import.partial", { created: result.created, failed: result.failed }));
          setError(result.errors.join("\n"));
        }
      } catch (err) {
        setPhase("idle");
        setProgress(null);
        const message = err instanceof ImportError ? err.message : undefined;
        handleError(err, toast.error, { context: "Import memos" });
        if (message) setError(message);
      }
    },
    [selectedSpaceName, t, user],
  );

  const busy = phase === "parsing" || phase === "importing";
  const progressPercent = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <SettingSection title={t("setting.import.label")} description={t("setting.import.description")}>
      <SettingGroup>
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-6 text-muted-foreground">{t("setting.import.formats")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".json,.csv,.md,.zip,application/json,text/csv,text/markdown,application/zip"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleFileSelected(file);
              }}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={busy}>
              <UploadIcon className="size-4" strokeWidth={1.8} />
              {t("setting.import.choose-file")}
            </Button>
            {fileName && <span className="truncate text-sm text-muted-foreground">{fileName}</span>}
          </div>

          {phase === "parsing" && <p className="text-sm text-muted-foreground">{t("setting.import.parsing")}</p>}

          {progress && (
            <div className="flex flex-col gap-1.5">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progressPercent}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">
                {t("setting.import.progress", { completed: progress.completed, total: progress.total, failed: progress.failed })}
              </p>
            </div>
          )}

          {phase === "done" && progress && (
            <p className="text-sm text-foreground">{t("setting.import.finished", { count: progress.completed })}</p>
          )}

          {warnings.length > 0 && (
            <ul className="list-disc space-y-0.5 ps-5 text-xs text-muted-foreground">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          {error && (
            <pre className="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/30 p-3 text-xs text-destructive">{error}</pre>
          )}
        </div>
      </SettingGroup>
    </SettingSection>
  );
};

export default ImportSection;
