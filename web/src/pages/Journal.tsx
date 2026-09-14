import { Navigate, useLocation, useParams } from "react-router-dom";
import type { JournalRouteParams } from "@/components/JournalView";
import { buildJournalPath, JournalView, parseJournalDate } from "@/components/JournalView";
import { collectionPathForLocation } from "@/router/routes";

/**
 * `/journal` and `/journal/:date` — the default is today; anything that is not a real
 * calendar day lands back on `/journal` (today).
 */
const Journal = () => {
  const location = useLocation();
  const params = useParams<JournalRouteParams>();
  const date = parseJournalDate(params.date);
  if (!date) {
    return (
      <Navigate to={{ pathname: collectionPathForLocation(buildJournalPath(), location.pathname), search: location.search }} replace />
    );
  }
  return <JournalView date={date} />;
};

export default Journal;
