import { TrashIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavStrings } from "./i18n";
import { MAX_CUSTOM_ENGINES, type SearchEngine, type SearchEngineId } from "./searchEngines";

/** Add / remove user-defined engines next to the built-in chips. */
export const EngineDialog = ({
  customEngines,
  onClose,
  onAdd,
  onRemove,
}: {
  customEngines: SearchEngine[];
  onClose: () => void;
  onAdd: (draft: { label: string; urlTemplate: string }) => string | null;
  onRemove: (id: SearchEngineId) => void;
}) => {
  const t = useNavStrings();
  const [label, setLabel] = useState("");
  const [urlTemplate, setUrlTemplate] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const problem = onAdd({ label, urlTemplate });
    if (problem) {
      setError(problem);
      return;
    }
    setLabel("");
    setUrlTemplate("");
    setError(null);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="nav-engine-dialog">
        <DialogHeader>
          <DialogTitle>{t.addSearchEngine}</DialogTitle>
          <DialogDescription>{t.addSearchEngineHint}</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-engine-label">{t.fieldEngineLabel}</Label>
            <Input
              id="nav-engine-label"
              data-testid="nav-engine-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-engine-template">{t.fieldEngineTemplate}</Label>
            <Input
              id="nav-engine-template"
              data-testid="nav-engine-template"
              value={urlTemplate}
              onChange={(e) => setUrlTemplate(e.target.value)}
              placeholder="https://example.com/search?q={q}"
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="nav-engine-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" size="sm" data-testid="nav-engine-submit" disabled={customEngines.length >= MAX_CUSTOM_ENGINES}>
              {t.save}
            </Button>
          </DialogFooter>
        </form>
        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">{t.customEngines}</p>
          {customEngines.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="nav-engine-custom-empty">
              {t.customEnginesEmpty}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {customEngines.map((engine) => (
                <li
                  key={engine.id}
                  className="flex items-center gap-2 rounded-md px-1 py-0.5"
                  data-testid={`nav-engine-custom-${engine.id}`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{engine.label}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    aria-label={`${t.removeSearchEngine}: ${engine.label}`}
                    data-testid={`nav-engine-remove-${engine.id}`}
                    onClick={() => onRemove(engine.id)}
                  >
                    <TrashIcon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
