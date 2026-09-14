import { create } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";
import { memoServiceClient } from "@/connect";
import { useView } from "@/contexts/ViewContext";
import { memoKeys } from "@/hooks/useMemoQueries";
import { getLocalDayTimestampRange, withTimestampRange } from "@/lib/calendar-utils";
import { State } from "@/types/proto/api/v1/common_pb";
import { ListMemosRequestSchema, type Memo } from "@/types/proto/api/v1/memo_service_pb";

/** A single personal day is always one page; the loop still drains any overflow. */
const DAY_PAGE_SIZE = 500;
const NO_MEMOS: Memo[] = [];

export interface UseDayMemosOptions {
  /** `YYYY-MM-DD` */
  date: string;
  /** CEL clauses fixing whose memos and which collection; the day range is added here. */
  filter?: string;
  enabled?: boolean;
}

/** Every page of the day: a truncated journal would drop the evening's notes. */
const listWholeDay = async (filter: string | undefined, orderBy: string): Promise<Memo[]> => {
  const memos: Memo[] = [];
  let pageToken = "";
  do {
    const response = await memoServiceClient.listMemos(
      create(ListMemosRequestSchema, { state: State.NORMAL, filter, orderBy, pageSize: DAY_PAGE_SIZE, pageToken }),
    );
    memos.push(...response.memos);
    pageToken = response.nextPageToken;
  } while (pageToken);
  return memos;
};

/**
 * Every memo of one calendar day, oldest first so the journal reads as the day unfolded.
 * Lives under the memo list cache key so create/update/delete mutations invalidate it.
 */
export const useDayMemos = ({ date, filter, enabled = true }: UseDayMemosOptions) => {
  const { timeBasis } = useView();
  const dayFilter = withTimestampRange(filter, getLocalDayTimestampRange(date), timeBasis);
  const orderBy = `${timeBasis} asc`;

  const query = useQuery({
    queryKey: [...memoKeys.lists(), "journal-day", { filter: dayFilter, orderBy }],
    queryFn: () => listWholeDay(dayFilter, orderBy),
    enabled: enabled && Boolean(date),
    staleTime: 1000 * 30,
  });

  return {
    memos: query.data ?? NO_MEMOS,
    isLoading: query.isLoading,
    error: query.isError ? query.error : undefined,
    refetch: query.refetch,
  };
};
