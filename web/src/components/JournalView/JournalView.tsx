import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { MentionResolutionProvider } from "@/components/MemoContent/MentionResolutionContext";
import MemoEditor from "@/components/MemoEditor";
import { deriveDefaultCreateTimeFromDate } from "@/components/MemoEditor/utils/deriveDefaultCreateTime";
import MemoView from "@/components/MemoView";
import { buttonVariants } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { NewMemoProvider } from "@/contexts/NewMemoContext";
import { useSpaceContext } from "@/contexts/SpaceContext";
import { useView } from "@/contexts/ViewContext";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useMemoFilters } from "@/hooks/useMemoFilters";
import { getToday, parseLocalDate } from "@/lib/calendar-utils";
import { combineCELFilters } from "@/lib/cel-filter";
import { buildMemoCreatorFilter } from "@/lib/resource-names";
import { cn } from "@/lib/utils";
import { collectionPathForLocation } from "@/router/routes";
import { useTranslate } from "@/utils/i18n";
import { buildJournalPath } from "./paths";
import { useDayMemos } from "./useDayMemos";

export interface JournalViewProps {
  /** `YYYY-MM-DD` */
  date: string;
}

/**
 * One day as a journal page: a date navigator, a quiet always-open composer seeded to that
 * day, and the day's memos oldest-first so the page reads as the day unfolded. Data is
 * scoped like Home to the remembered Space collection and the sidebar's view/tag filters.
 */
export const JournalView = ({ date }: JournalViewProps) => {
  const t = useTranslate();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const user = useCurrentUser();
  const { isUserSettingsInitialized } = useAuth();
  const { memoFilter: contextFilter, selectedSpaceName } = useSpaceContext();
  const { compactMode } = useView();

  const viewFilter = useMemoFilters({ includeMemoViews: true, includePinned: true });
  const memoFilter = useMemo(() => combineCELFilters(viewFilter, user && buildMemoCreatorFilter(user.name)), [viewFilter, user]);
  const dayFilter = useMemo(() => combineCELFilters(contextFilter, memoFilter), [contextFilter, memoFilter]);

  const { memos, isLoading, error, refetch } = useDayMemos({
    date,
    filter: dayFilter,
    enabled: Boolean(user) && isUserSettingsInitialized,
  });

  const defaultCreateTime = useMemo(() => deriveDefaultCreateTimeFromDate(date), [date]);
  const dateLabel = useMemo(
    () =>
      parseLocalDate(date)?.toLocaleDateString(i18n.language, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) ?? date,
    [date, i18n.language],
  );
  const contents = useMemo(() => memos.map((memo) => memo.content), [memos]);
  const userNames = useMemo(
    () => Array.from(new Set(memos.flatMap((memo) => memo.reactions.map((reaction) => reaction.creator)))),
    [memos],
  );
  const today = getToday();
  const isToday = date === today;

  const goToDate = (next: string) => {
    navigate({ pathname: collectionPathForLocation(buildJournalPath(next), pathname), search });
  };

  const shiftDay = (delta: number) => {
    const base = parseLocalDate(date);
    if (!base) return;
    base.setDate(base.getDate() + delta);
    const next = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    goToDate(next);
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pb-8">
      <header className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{dateLabel}</h1>
          <p className="text-sm text-muted-foreground">{isToday ? t("journal.today") : t("journal.day-count", { count: memos.length })}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t("journal.previous-day")}
            className={cn(buttonVariants({ variant: "outline", size: "icon-compact" }))}
            onClick={() => shiftDay(-1)}
          >
            <ChevronLeftIcon strokeWidth={1.8} />
          </button>
          {!isToday && (
            <button type="button" className={cn(buttonVariants({ variant: "quiet", size: "sm" }))} onClick={() => goToDate(today)}>
              {t("journal.go-to-today")}
            </button>
          )}
          <button
            type="button"
            aria-label={t("journal.next-day")}
            className={cn(buttonVariants({ variant: "outline", size: "icon-compact" }))}
            onClick={() => shiftDay(1)}
          >
            <ChevronRightIcon strokeWidth={1.8} />
          </button>
        </div>
      </header>

      <NewMemoProvider>
        {isUserSettingsInitialized && (
          <MemoEditor
            cacheKey={`journal-editor:${selectedSpaceName ?? "global"}:${date}`}
            autoFocus={false}
            placeholder={t("journal.composer-placeholder")}
            defaultCreateTime={defaultCreateTime}
            defaultSpace={selectedSpaceName}
          />
        )}

        <MentionResolutionProvider contents={contents} userNames={userNames}>
          {error ? (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-border/60 bg-muted/30 p-4 text-sm text-muted-foreground">
              <span>{t("journal.load-error")}</span>
              <button type="button" className={cn(buttonVariants({ variant: "outline", size: "sm" }))} onClick={() => refetch()}>
                {t("journal.retry")}
              </button>
            </div>
          ) : isLoading ? (
            <p className="py-6 text-sm text-muted-foreground">{t("journal.loading")}</p>
          ) : memos.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">{t("journal.empty")}</p>
          ) : (
            memos.map((memo) => (
              <MemoView
                key={memo.name}
                memo={memo}
                timeDisplay="time"
                showVisibility
                showPinned
                showSpace={!selectedSpaceName}
                compact={compactMode}
              />
            ))
          )}
        </MentionResolutionProvider>
      </NewMemoProvider>
    </div>
  );
};
