import { PencilIcon, TrashIcon } from "lucide-react";
import type { DragEvent as ReactDragEvent } from "react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavStrings } from "./i18n";
import type { NavCard } from "./types";

const LOGO_TIMEOUT_MS = 1200;

const hostLabel = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/** Deterministic pastel tint so letter avatars look distinct without assets. */
const letterTint = (seed: string): { background: string; color: string } => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return {
    background: `oklch(0.86 0.06 ${hue})`,
    color: `oklch(0.38 0.1 ${hue})`,
  };
};

/** Only the site's own favicon — fail fast to a letter tile instead of chaining CDNs. */
const logoSource = (url: string): string | null => {
  try {
    return `${new URL(url).origin}/favicon.ico`;
  } catch {
    return null;
  }
};

/** Site favicon, or a first-letter avatar when the icon is missing/slow. */
export const CardLogo = memo(function CardLogo({ url, title }: { url: string; title: string }) {
  const frameRef = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const host = hostLabel(url);
  const letter = (host || title || "?").charAt(0).toUpperCase();
  const tint = useMemo(() => letterTint(host || title || url), [host, title, url]);
  const src = useMemo(() => logoSource(url), [url]);

  // Only start the network request once the tile is near the viewport.
  useEffect(() => {
    if (!src || failed || loaded || near) return;
    const el = frameRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: "180px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src, failed, loaded, near]);

  // Hanging requests never fire onError — cut over to the letter tile on a deadline.
  useEffect(() => {
    if (!near || !src || failed || loaded) return;
    const timer = window.setTimeout(() => setFailed(true), LOGO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [near, src, failed, loaded]);

  if (!src || failed) {
    return (
      <span
        ref={frameRef}
        aria-hidden
        className="nav-page-logo-frame flex size-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-semibold"
        style={tint}
        data-testid="nav-card-logo-fallback"
      >
        {letter}
      </span>
    );
  }

  return (
    <span
      ref={frameRef}
      className="nav-page-logo-frame relative size-8 shrink-0 overflow-hidden rounded-lg"
      data-testid="nav-card-logo-wrap"
    >
      <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold" style={tint}>
        {letter}
      </span>
      {near ? (
        <img
          src={src}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`nav-page-logo absolute inset-0 size-full transition-opacity duration-150 ${loaded ? "opacity-100" : "opacity-0"}`}
          data-testid="nav-card-logo"
        />
      ) : null}
    </span>
  );
});

export const NavCardTile = ({
  card,
  active,
  dropBefore,
  dropAfter,
  dragDisabled,
  dragging,
  cardRef,
  onFocus,
  onEdit,
  onDelete,
  onDragStartCard,
  onDragOverCard,
  onDropCard,
  onDragEndCard,
}: {
  card: NavCard;
  active: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  dragDisabled: boolean;
  dragging: boolean;
  cardRef: (el: HTMLAnchorElement | null) => void;
  onFocus: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDragStartCard: (event: ReactDragEvent<HTMLAnchorElement>) => void;
  onDragOverCard: (event: ReactDragEvent<HTMLAnchorElement>) => void;
  onDropCard: (event: ReactDragEvent<HTMLAnchorElement>) => void;
  onDragEndCard: () => void;
}) => {
  const t = useNavStrings();
  return (
    <div className="nav-page-card-shell group relative">
      <a
        ref={cardRef}
        href={card.url}
        target="_blank"
        rel="noreferrer"
        tabIndex={-1}
        draggable={!dragDisabled}
        data-active={active ? "true" : undefined}
        data-dragging={dragging ? "true" : undefined}
        onFocus={onFocus}
        onDragStart={onDragStartCard}
        onDragOver={onDragOverCard}
        onDrop={onDropCard}
        onDragEnd={onDragEndCard}
        data-drop-before={dropBefore ? "true" : undefined}
        data-drop-after={dropAfter ? "true" : undefined}
        className="nav-page-card flex flex-col gap-2.5 rounded-xl p-3.5 focus:outline-none"
        data-testid="nav-card"
      >
        <span className="flex items-center gap-3">
          <CardLogo url={card.url} title={card.title} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">{card.title}</span>
            {card.note ? <span className="line-clamp-1 text-xs text-muted-foreground">{card.note}</span> : null}
          </span>
        </span>
        <span className="truncate text-xs text-muted-foreground/70">{hostLabel(card.url)}</span>
      </a>
      <div className="nav-page-card-actions pointer-events-none absolute end-2 top-2 flex gap-1 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          aria-label={t.editCard}
          data-testid="nav-card-edit"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onEdit();
          }}
        >
          <PencilIcon className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          aria-label={t.deleteCard}
          data-testid="nav-card-delete"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onDelete();
          }}
        >
          <TrashIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
};
