import {
  ChevronDownIcon,
  ChevronRightIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  SquareArrowOutUpRightIcon,
  TrashIcon,
} from "lucide-react";
import type { DragEvent as ReactDragEvent } from "react";
import { Button } from "@/components/ui/button";
import { useNavStrings } from "./i18n";
import { NavCardTile } from "./NavCardTile";
import type { NavCard, NavGroup } from "./types";
import type { DropHint } from "./useNavDnd";

/** One collapsible group header plus its card wall (or empty drop target). */
export const NavGroupSection = ({
  group,
  groupIndex,
  canDrag,
  draggingGroupId,
  groupDropHint,
  draggingCardId,
  cardDropHint,
  activeCardId,
  onToggleCollapse,
  onOpenAll,
  onAddCard,
  onRenameGroup,
  onDeleteGroup,
  onEditCard,
  onDeleteCard,
  onActiveCardChange,
  registerCardRef,
  onGroupDragStart,
  onGroupDragOver,
  onGroupDrop,
  onDragEnd,
  onCardDragStart,
  onCardDragOver,
  onCardDrop,
  onEmptyGroupDragOver,
}: {
  group: NavGroup;
  groupIndex: number;
  canDrag: boolean;
  draggingGroupId: string | null;
  groupDropHint: number | null;
  draggingCardId: string | null;
  cardDropHint: DropHint | null;
  activeCardId: string | null;
  onToggleCollapse: (group: NavGroup) => void;
  onOpenAll: (group: NavGroup) => void;
  onAddCard: (groupId: string) => void;
  onRenameGroup: (group: NavGroup) => void;
  onDeleteGroup: (group: NavGroup) => void;
  onEditCard: (group: NavGroup, card: NavCard) => void;
  onDeleteCard: (group: NavGroup, card: NavCard) => void;
  onActiveCardChange: (id: string | null) => void;
  registerCardRef: (id: string, el: HTMLAnchorElement | null) => void;
  onGroupDragStart: (group: NavGroup) => (event: ReactDragEvent<HTMLButtonElement>) => void;
  onGroupDragOver: (index: number) => (event: ReactDragEvent<HTMLButtonElement>) => void;
  onGroupDrop: () => void;
  onDragEnd: () => void;
  onCardDragStart: (group: NavGroup, index: number) => (event: ReactDragEvent<HTMLAnchorElement>) => void;
  onCardDragOver: (group: NavGroup, index: number) => (event: ReactDragEvent<HTMLAnchorElement>) => void;
  onCardDrop: () => void;
  onEmptyGroupDragOver: (group: NavGroup) => (event: ReactDragEvent<HTMLParagraphElement>) => void;
}) => {
  const t = useNavStrings();
  return (
    <div className="flex flex-col gap-3" data-testid="nav-group">
      <div className="flex items-center gap-1.5 self-start">
        <button
          type="button"
          draggable={canDrag}
          onDragStart={onGroupDragStart(group)}
          onDragOver={onGroupDragOver(groupIndex)}
          onDrop={onGroupDrop}
          onDragEnd={onDragEnd}
          data-dragging={draggingGroupId === group.id ? "true" : undefined}
          data-drop-before={groupDropHint === groupIndex ? "true" : undefined}
          data-drop-after={groupDropHint === groupIndex + 1 ? "true" : undefined}
          className={`nav-page-group group flex items-center gap-1.5 rounded-full px-2.5 py-1 text-foreground ${canDrag ? "cursor-grab" : ""}`}
          onClick={() => onToggleCollapse(group)}
          aria-expanded={!group.collapsed}
        >
          {canDrag ? <GripVerticalIcon className="size-3.5 text-muted-foreground/50 group-hover:text-muted-foreground" /> : null}
          {group.collapsed ? (
            <ChevronRightIcon className="size-3.5 text-muted-foreground" />
          ) : (
            <ChevronDownIcon className="size-3.5 text-muted-foreground" />
          )}
          <span className="text-sm font-medium leading-none">{group.name}</span>
          <span className="nav-page-count flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-medium leading-5">
            {group.items.length}
          </span>
          <span className="sr-only">{group.collapsed ? t.expand : t.collapse}</span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t.openAllLinks}
          title={t.openAllLinks}
          data-testid="nav-open-all"
          disabled={group.items.length === 0}
          onClick={() => onOpenAll(group)}
        >
          <SquareArrowOutUpRightIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t.addCard}
          data-testid="nav-add-card"
          onClick={() => onAddCard(group.id)}
        >
          <PlusIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t.renameGroup}
          data-testid="nav-rename-group"
          onClick={() => onRenameGroup(group)}
        >
          <PencilIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label={t.deleteGroup}
          data-testid="nav-delete-group"
          onClick={() => onDeleteGroup(group)}
        >
          <TrashIcon className="size-3.5" />
        </Button>
      </div>

      {!group.collapsed ? (
        group.items.length === 0 ? (
          <p
            className="border-border rounded-xl border border-dashed p-4 text-sm text-muted-foreground"
            onDragOver={onEmptyGroupDragOver(group)}
            onDrop={onCardDrop}
            onDragEnd={onDragEnd}
          >
            {t.emptyGroup}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {group.items.map((card, index) => (
              <NavCardTile
                key={card.id}
                card={card}
                active={card.id === activeCardId}
                dropBefore={cardDropHint?.groupId === group.id && cardDropHint.index === index}
                dropAfter={cardDropHint?.groupId === group.id && cardDropHint.index === index + 1}
                dragDisabled={!canDrag}
                dragging={draggingCardId === card.id}
                onFocus={() => onActiveCardChange(card.id)}
                onEdit={() => onEditCard(group, card)}
                onDelete={() => onDeleteCard(group, card)}
                cardRef={(el) => registerCardRef(card.id, el)}
                onDragStartCard={onCardDragStart(group, index)}
                onDragOverCard={onCardDragOver(group, index)}
                onDropCard={onCardDrop}
                onDragEndCard={onDragEnd}
              />
            ))}
          </div>
        )
      ) : null}
    </div>
  );
};
