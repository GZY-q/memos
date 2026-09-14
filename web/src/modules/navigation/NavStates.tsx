import { LoaderCircleIcon, RotateCcwIcon, WifiOffIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavStrings } from "./i18n";

export const LoadingState = () => {
  const t = useNavStrings();
  return (
    <section className="border-border bg-card flex items-center gap-2 rounded-xl border p-6 text-sm text-muted-foreground">
      <LoaderCircleIcon className="size-4 animate-spin" />
      <span>{t.loading}</span>
    </section>
  );
};

export const EmptyState = ({ onRetry }: { onRetry: () => void }) => {
  const t = useNavStrings();
  return (
    <section className="border-border bg-card flex flex-col items-start gap-3 rounded-xl border p-6">
      <h2 className="text-sm font-medium text-foreground">{t.emptyTitle}</h2>
      <p className="text-sm text-muted-foreground">{t.emptyBody}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcwIcon />
        {t.retry}
      </Button>
    </section>
  );
};

export const DegradedState = ({ onRetry }: { onRetry: () => void }) => {
  const t = useNavStrings();
  return (
    <section className="border-border bg-card flex flex-col items-start gap-2 rounded-xl border p-6">
      <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
        <WifiOffIcon className="size-4" />
        {t.degradedTitle}
      </h2>
      <p className="text-sm text-muted-foreground">{t.degradedBody}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCcwIcon />
        {t.retry}
      </Button>
    </section>
  );
};

export const SearchEmptyState = ({ onClear }: { onClear: () => void }) => {
  const t = useNavStrings();
  return (
    <section
      className="border-border bg-card flex flex-col items-start gap-2 rounded-xl border p-6"
      role="status"
      data-testid="nav-search-empty"
    >
      <h2 className="text-sm font-medium text-foreground">{t.searchEmptyTitle}</h2>
      <p className="text-sm text-muted-foreground">{t.searchEmptyBody}</p>
      <Button variant="outline" size="sm" onClick={onClear}>
        <XIcon />
        {t.clearSearch}
      </Button>
    </section>
  );
};
