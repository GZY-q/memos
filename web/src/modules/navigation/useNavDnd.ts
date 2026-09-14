import type { DragEvent as ReactDragEvent } from "react";
import { useCallback, useRef, useState } from "react";
import { moveCard, moveGroup } from "./reorder";
import type { NavConfig, NavGroup } from "./types";

export interface CardDrag {
  cardId: string;
  groupId: string;
  index: number;
}

export interface DropHint {
  groupId: string;
  index: number;
}

const resolveDropIndex = (event: ReactDragEvent<HTMLElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY > rect.top + rect.height / 2 ? 1 : 0;
};

/**
 * Card-in-group and group-reorder drag-and-drop. Pure move helpers stay in
 * `reorder.ts`; this hook only tracks drag state and fires the persist callback.
 */
export function useNavDnd({ state, persistQuiet }: { state: NavConfig | null; persistQuiet: (next: NavConfig) => void }) {
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null);
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [cardDropHint, setCardDropHint] = useState<DropHint | null>(null);
  const [groupDropHint, setGroupDropHint] = useState<number | null>(null);
  const cardDragRef = useRef<CardDrag | null>(null);
  const groupDragRef = useRef<string | null>(null);

  const endDrag = useCallback(() => {
    setDraggingCardId(null);
    setDraggingGroupId(null);
    setCardDropHint(null);
    setGroupDropHint(null);
    cardDragRef.current = null;
    groupDragRef.current = null;
  }, []);

  const handleCardDragStart = useCallback(
    (group: NavGroup, index: number) => (event: ReactDragEvent<HTMLAnchorElement>) => {
      cardDragRef.current = { cardId: group.items[index].id, groupId: group.id, index };
      setDraggingCardId(group.items[index].id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", group.items[index].url);
    },
    [],
  );

  const handleCardDragOver = useCallback(
    (group: NavGroup, index: number) => (event: ReactDragEvent<HTMLAnchorElement>) => {
      if (!cardDragRef.current) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setCardDropHint({ groupId: group.id, index: index + resolveDropIndex(event) });
    },
    [],
  );

  const handleCardDrop = useCallback(() => {
    const drag = cardDragRef.current;
    if (!drag || !state || !cardDropHint) {
      endDrag();
      return;
    }
    const next = moveCard(state, drag.cardId, cardDropHint.groupId, cardDropHint.index);
    persistQuiet(next);
    endDrag();
  }, [state, cardDropHint, persistQuiet, endDrag]);

  const handleEmptyGroupDragOver = useCallback(
    (group: NavGroup) => (event: ReactDragEvent<HTMLParagraphElement>) => {
      if (!cardDragRef.current) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setCardDropHint({ groupId: group.id, index: 0 });
    },
    [],
  );

  const handleGroupDragStart = useCallback(
    (group: NavGroup) => (event: ReactDragEvent<HTMLButtonElement>) => {
      groupDragRef.current = group.id;
      setDraggingGroupId(group.id);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `nav-group:${group.id}`);
    },
    [],
  );

  const handleGroupDragOver = useCallback(
    (index: number) => (event: ReactDragEvent<HTMLButtonElement>) => {
      if (!groupDragRef.current) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setGroupDropHint(index + resolveDropIndex(event));
    },
    [],
  );

  const handleGroupDrop = useCallback(() => {
    const groupId = groupDragRef.current;
    if (!groupId || !state || groupDropHint === null) {
      endDrag();
      return;
    }
    const next = moveGroup(state, groupId, groupDropHint);
    persistQuiet(next);
    endDrag();
  }, [state, groupDropHint, persistQuiet, endDrag]);

  return {
    draggingCardId,
    draggingGroupId,
    cardDropHint,
    groupDropHint,
    endDrag,
    handleCardDragStart,
    handleCardDragOver,
    handleCardDrop,
    handleEmptyGroupDragOver,
    handleGroupDragStart,
    handleGroupDragOver,
    handleGroupDrop,
  };
}
