import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CardDraft, CardDraftError } from "./editor";
import { validateCardDraft } from "./editor";
import { useNavStrings } from "./i18n";
import type { NavConfig } from "./types";

export interface CardDialogState {
  open: true;
  mode: "create" | "edit";
  groupId: string;
  cardId?: string;
  initial: CardDraft;
}

const draftErrorMessage = (error: CardDraftError, t: ReturnType<typeof useNavStrings>): string =>
  error === "titleRequired" ? t.titleRequired : error === "urlInvalid" ? t.urlInvalid : t.urlDuplicate;

export const CardDialog = ({
  state,
  config,
  onClose,
  onSubmit,
}: {
  state: CardDialogState;
  config: NavConfig;
  onClose: () => void;
  onSubmit: (draft: CardDraft, groupId: string) => void;
}) => {
  const t = useNavStrings();
  const [title, setTitle] = useState(state.initial.title);
  const [url, setUrl] = useState(state.initial.url);
  const [note, setNote] = useState(state.initial.note ?? "");
  const [groupId, setGroupId] = useState(state.groupId);
  const [error, setError] = useState<string | null>(null);
  const isCreate = state.mode === "create";
  const groupOptions = config.groups.map((group) => ({ id: group.id, name: group.name }));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const draft: CardDraft = { title, url, note };
    const problem = validateCardDraft(draft, config, state.cardId);
    if (problem) {
      setError(draftErrorMessage(problem, t));
      return;
    }
    onSubmit(draft, groupId);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="nav-card-dialog">
        <DialogHeader>
          <DialogTitle>{isCreate ? t.addCard : t.editCard}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-card-title">{t.fieldTitle}</Label>
            <Input id="nav-card-title" data-testid="nav-card-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-card-url">{t.fieldUrl}</Label>
            <Input
              id="nav-card-url"
              data-testid="nav-card-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-card-note">{t.fieldNote}</Label>
            <Input id="nav-card-note" data-testid="nav-card-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {isCreate && groupOptions.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>{t.fieldGroup}</Label>
              <Select
                value={groupId}
                items={groupOptions.map((group) => ({ value: group.id, label: group.name }))}
                onValueChange={setGroupId}
              >
                <SelectTrigger className="w-full" data-testid="nav-card-group">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupOptions.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="nav-card-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" size="sm" data-testid="nav-card-submit">
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
