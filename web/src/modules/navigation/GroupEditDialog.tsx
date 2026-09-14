import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavStrings } from "./i18n";

export interface NameDialogState {
  open: true;
  mode: "create" | "rename";
  groupId?: string;
  initialName: string;
}

export interface ConfirmDialogState {
  open: true;
  kind: "card" | "group";
  groupId: string;
  cardId?: string;
}

export const NameDialog = ({
  state,
  onClose,
  onSubmit,
}: {
  state: NameDialogState;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) => {
  const t = useNavStrings();
  const [name, setName] = useState(state.initialName);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t.nameRequired);
      return;
    }
    onSubmit(name);
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="nav-name-dialog">
        <DialogHeader>
          <DialogTitle>{state.mode === "create" ? t.addGroup : t.renameGroup}</DialogTitle>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nav-group-name">{t.fieldName}</Label>
            <Input id="nav-group-name" data-testid="nav-group-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert" data-testid="nav-name-error">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button type="submit" size="sm" data-testid="nav-name-submit">
              {t.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export const ConfirmDialog = ({ state, onClose, onConfirm }: { state: ConfirmDialogState; onClose: () => void; onConfirm: () => void }) => {
  const t = useNavStrings();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="nav-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{state.kind === "card" ? t.deleteCard : t.deleteGroup}</DialogTitle>
          <DialogDescription>{state.kind === "card" ? t.deleteCardConfirm : t.deleteGroupConfirm}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="button" variant="destructive" size="sm" data-testid="nav-confirm-delete" onClick={onConfirm}>
            {t.delete}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const OpenAllConfirmDialog = ({ count, onClose, onConfirm }: { count: number; onClose: () => void; onConfirm: () => void }) => {
  const t = useNavStrings();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="sm" data-testid="nav-open-all-dialog">
        <DialogHeader>
          <DialogTitle>{t.openAllLinksTitle}</DialogTitle>
          <DialogDescription>{t.openAllLinksConfirm(count)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            {t.cancel}
          </Button>
          <Button type="button" size="sm" data-testid="nav-open-all-confirm" onClick={onConfirm}>
            {t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
