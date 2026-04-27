import { useState, useEffect, useRef } from "react";
import type { Book } from "../types";

interface Props {
  book: Book | null;
  open: boolean;
  onClose: () => void;
  isSelected: boolean;
  onRemove: (book: Book) => void;
  anchorX: number;
  anchorY: number;
  anchorW: number;
  anchorH: number;
}

function proxyCover(raw: string): string {
  return raw.replace("https://cdn.sanity.io", "/sanity-cdn");
}

function truncateDesc(text: string, max: number): string {
  if (text.length <= max) return text;
  const dotIdx = text.indexOf(". ");
  if (dotIdx > 0 && dotIdx <= max) {
    const secondDot = text.indexOf(". ", dotIdx + 2);
    if (secondDot > 0 && secondDot <= max) return text.slice(0, secondDot + 1);
    return text.slice(0, dotIdx + 1);
  }
  const cut = text.lastIndexOf(" ", max);
  return text.slice(0, cut > 0 ? cut : max) + "…";
}

const CARD_W = 320;
const GAP = 16;
const VP_PAD = 24;

function computePosition(
  ax: number, ay: number, aw: number, ah: number,
  cardH: number
): { x: number; y: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const candidates: { x: number; y: number; score: number }[] = [];

  const rightX = ax + aw + GAP;
  const leftX = ax - CARD_W - GAP;
  const centerY = Math.max(VP_PAD, Math.min(ay + ah / 2 - cardH / 2, vh - cardH - VP_PAD));
  const centerX = Math.max(VP_PAD, Math.min(ax + aw / 2 - CARD_W / 2, vw - CARD_W - VP_PAD));
  const belowY = ay + ah + GAP;
  const aboveY = ay - cardH - GAP;

  if (rightX + CARD_W + VP_PAD <= vw) {
    candidates.push({ x: rightX, y: centerY, score: 4 });
  }
  if (leftX >= VP_PAD) {
    candidates.push({ x: leftX, y: centerY, score: 3 });
  }
  if (belowY + cardH + VP_PAD <= vh) {
    candidates.push({ x: centerX, y: belowY, score: 2 });
  }
  if (aboveY >= VP_PAD) {
    candidates.push({ x: centerX, y: aboveY, score: 1 });
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  return {
    x: Math.max(VP_PAD, Math.min(rightX, vw - CARD_W - VP_PAD)),
    y: Math.max(VP_PAD, Math.min(centerY, vh - cardH - VP_PAD)),
  };
}

export default function DetailPanel({
  book,
  open,
  onClose,
  isSelected,
  onRemove,
  anchorX,
  anchorY,
  anchorW,
  anchorH,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [contentKey, setContentKey] = useState("");
  const [visible, setVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const prevBookId = useRef<string | null>(null);

  useEffect(() => {
    if (!book || !open) {
      setVisible(false);
      prevBookId.current = null;
      return;
    }

    if (book.id !== prevBookId.current) {
      setExpanded(false);
      setContentKey(book.id);
      prevBookId.current = book.id;
    }

    const estH = expanded ? 500 : 320;
    const p = computePosition(anchorX, anchorY, anchorW, anchorH, estH);
    setPos(p);

    requestAnimationFrame(() => setVisible(true));
  }, [book, open, anchorX, anchorY, anchorW, anchorH, expanded]);

  useEffect(() => {
    if (!cardRef.current || !open) return;
    const h = cardRef.current.offsetHeight;
    const p = computePosition(anchorX, anchorY, anchorW, anchorH, h);
    setPos(p);
  }, [contentKey, expanded, anchorX, anchorY, anchorW, anchorH, open]);

  if (!book) return null;

  const metaParts: string[] = [];
  if (book.author) metaParts.push(book.author);
  if (book.year != null) metaParts.push(String(book.year));

  const desc = book.description || "";
  const needsExpand = desc.length > 140;
  const shortDesc = needsExpand ? truncateDesc(desc, 140) : desc;

  return (
    <div
      ref={cardRef}
      className="fixed z-40 pointer-events-auto"
      style={{
        width: CARD_W,
        left: pos.x,
        top: pos.y,
        maxHeight: "calc(100vh - 80px)",
        borderRadius: 12,
        background: "rgba(20, 20, 20, 0.72)",
        backdropFilter: "blur(24px) saturate(1.2)",
        WebkitBackdropFilter: "blur(24px) saturate(1.2)",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
        opacity: visible && open ? 1 : 0,
        transform: visible && open ? "scale(1)" : "scale(0.96)",
        transition: "left 200ms ease-out, top 200ms ease-out, opacity 150ms ease-out, transform 150ms ease-out",
        overflowY: expanded ? "auto" : "hidden",
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-2.5 right-2.5 w-6 h-6 flex items-center justify-center
                   text-secondary/60 hover:text-star transition-colors z-50 rounded-full
                   hover:bg-white/[0.06]"
        aria-label="Close"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2L10 10M10 2L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>

      <div key={contentKey} className="p-5" style={{ animation: "cardFadeIn 150ms ease-out" }}>
        <style>{`@keyframes cardFadeIn { from { opacity: 0; } to { opacity: 1; } }`}</style>

        <div className="flex gap-4 mb-3">
          {book.coverUrl && (
            <img
              src={proxyCover(book.coverUrl) + "?w=160&fit=crop&auto=format"}
              alt=""
              className="w-[60px] h-[80px] object-cover rounded-sm flex-shrink-0 opacity-95"
            />
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="text-star text-[18px] font-sans font-bold leading-[1.3] mb-1 line-clamp-2">
              {book.title}
            </h2>
            {metaParts.length > 0 && (
              <p className="text-secondary/70 text-[12px] font-mono tracking-[0.02em]">
                {metaParts.join(" · ")}
              </p>
            )}
          </div>
        </div>

        {desc && (
          <div className="mb-3">
            <p className="text-star/[0.85] text-[14px] font-sans font-normal leading-[1.5]">
              {expanded ? desc : shortDesc}
            </p>
            {needsExpand && (
              <button
                onClick={() => setExpanded((e) => !e)}
                className="text-glow text-[13px] font-sans mt-1.5 hover:underline transition-colors"
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>
        )}

        {isSelected && (
          <>
            <div className="h-px bg-white/[0.06] mb-3" />
            <button
              onClick={() => onRemove(book)}
              className="w-full py-2 rounded-lg text-[13px] font-sans font-medium tracking-wide
                         transition-all duration-200
                         bg-white/[0.04] border border-white/[0.08] text-secondary/70
                         hover:bg-white/[0.07] hover:text-glow hover:border-glow/30"
            >
              Remove from selection
            </button>
          </>
        )}
      </div>
    </div>
  );
}
