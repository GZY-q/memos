import dayjs from "dayjs";
import { getToday, ISO_DATE_FORMAT, parseLocalDate } from "@/lib/calendar-utils";
import { ROUTES } from "@/router/routes";

/** The route's params as react-router hands them over. */
export type JournalRouteParams = { date?: string };

/** Canonical `/journal` or `/journal/YYYY-MM-DD` path, Space-agnostic. */
export const buildJournalPath = (date?: string): string => (date && date !== getToday() ? `${ROUTES.JOURNAL}/${date}` : ROUTES.JOURNAL);

/** A real `YYYY-MM-DD`, else undefined so the page can redirect to today. */
export const parseJournalDate = (value: string | undefined): string | undefined => {
  if (!value) return getToday();
  return parseLocalDate(value) ? value : undefined;
};

export const addDays = (date: string, count: number): string => dayjs(date).add(count, "day").format(ISO_DATE_FORMAT);
