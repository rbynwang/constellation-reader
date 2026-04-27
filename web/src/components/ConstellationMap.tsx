import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { Book, QuestionCandidate, AnnotatedBook, SavedConstellation } from "../types";
import QuestionPanel from "./QuestionPanel";
import GalleryPanel from "./GalleryPanel";
import DetailPanel from "./DetailPanel";

interface Props {
  books: Book[];
}

const WORLD_W = 8000;
const WORLD_H = 5000;

const DOT_TEX_RADIUS = 16;
const MAX_CONCURRENT_LOADS = 10;

// ── Tunable zoom thresholds ──────────────────────────────────────────
const DOT_PX_MIN = 3;
const DOT_PX_MAX = 200;
const ZOOM_MIN = 0.08;
const ZOOM_MAX = 8;
const COVER_LOAD_ZOOM = 0.15;
const COVER_FADE_START = 0.25;
const COVER_FADE_END = 0.45;
const TITLE_FADE_START = 1.5;
const TITLE_FADE_END = 2.5;
// ─────────────────────────────────────────────────────────────────────

// ── "Year unknown" bottom track ─────────────────────────────────────
const TRACK_DIVIDER_Y = 0.90;
const TRACK_TOP = 0.92;
const TRACK_BOT = 0.98;
const TRACK_SIZE_MUL = 0.7;
const TRACK_ALPHA_MUL = 0.6;
// ─────────────────────────────────────────────────────────────────────

// ── Selection ───────────────────────────────────────────────────────
const MAX_SELECTED = 3;
const SEL_COLOR = 0xe8b547;
const SEL_SIZE_BOOST = 1.25;
const HIT_RADIUS_MIN = 12;
const FR_COLOR = 0xe8b547;
const FR_LINE_ALPHA = 0.35;
const FR_OUTLINE_ALPHA = 0.7;
// ─────────────────────────────────────────────────────────────────────

const BREAK_YEAR = 1940;
const LEFT_FRAC = 0.12;
const MARGIN = 0.025;
const NO_COLOR_TINT = 0x8b8580;

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function clamp01(v: number): number {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}
function bookTint(dominantColor?: string): number {
  if (!dominantColor) return NO_COLOR_TINT;
  return parseInt(dominantColor.slice(1), 16);
}

const LOG_ZOOM_MIN = Math.log(ZOOM_MIN);
const LOG_ZOOM_RANGE = Math.log(ZOOM_MAX) - LOG_ZOOM_MIN;
const SIZE_RATIO = DOT_PX_MAX / DOT_PX_MIN;

function screenSize(z: number): number {
  const frac = (Math.log(z) - LOG_ZOOM_MIN) / LOG_ZOOM_RANGE;
  return DOT_PX_MIN * Math.pow(SIZE_RATIO, clamp01(frac));
}

function makeDotTexture(renderer: PIXI.IRenderer): PIXI.Texture {
  const r = DOT_TEX_RADIUS;
  const g = new PIXI.Graphics();
  g.beginFill(0xffffff, 0.03); g.drawCircle(r, r, r); g.endFill();
  g.beginFill(0xffffff, 0.07); g.drawCircle(r, r, r * 0.65); g.endFill();
  g.beginFill(0xffffff, 0.18); g.drawCircle(r, r, r * 0.4); g.endFill();
  g.beginFill(0xffffff, 0.6);  g.drawCircle(r, r, r * 0.22); g.endFill();
  g.beginFill(0xffffff, 1.0);  g.drawCircle(r, r, r * 0.1); g.endFill();
  return renderer.generateTexture(g, { resolution: 2 });
}

function yearToWX(year: number, yMin: number, yMax: number): number {
  if (year <= BREAK_YEAR) {
    const earlySpan = Math.max(BREAK_YEAR - yMin, 1);
    const t = (year - yMin) / earlySpan;
    return (MARGIN + t * LEFT_FRAC) * WORLD_W;
  }
  const lateSpan = Math.max(yMax - BREAK_YEAR, 1);
  const t = (year - BREAK_YEAR) / lateSpan;
  return (MARGIN + LEFT_FRAC + t * (1 - 2 * MARGIN - LEFT_FRAC)) * WORLD_W;
}

function wxToYear(wx: number, yMin: number, yMax: number): number {
  const frac = wx / WORLD_W;
  const breakFrac = MARGIN + LEFT_FRAC;
  if (frac <= breakFrac) {
    const t = (frac - MARGIN) / LEFT_FRAC;
    return yMin + t * (BREAK_YEAR - yMin);
  }
  const rightW = 1 - 2 * MARGIN - LEFT_FRAC;
  const t = (frac - breakFrac) / rightW;
  return BREAK_YEAR + t * (yMax - BREAK_YEAR);
}

function proxyCoverUrl(raw: string): string {
  return raw.replace("https://cdn.sanity.io", "/sanity-cdn");
}

interface NodeData {
  book: Book;
  dotSprite: PIXI.Sprite;
  coverSprite: PIXI.Sprite | null;
  wx: number;
  wy: number;
  tint: number;
  hasColor: boolean;
  noYear: boolean;
  selected: boolean;
  coverTex: PIXI.Texture | null;
  coverLoading: boolean;
  label: PIXI.Text | null;
}

export default function ConstellationMap({ books }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedBooks, setSelectedBooks] = useState<Book[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [detailBook, setDetailBook] = useState<Book | null>(null);
  const [detailAnchor, setDetailAnchor] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [restoredQuestions, setRestoredQuestions] = useState<QuestionCandidate[] | null>(null);
  const [restoredChosenIndex, setRestoredChosenIndex] = useState<number | null>(null);
  const [restoredFurtherReading, setRestoredFurtherReading] = useState<AnnotatedBook[] | null>(null);
  const [savedEntries, setSavedEntries] = useState<SavedConstellation[]>(() => {
    try { return JSON.parse(localStorage.getItem("ibi_gallery") || "[]"); }
    catch { return []; }
  });
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const clearSelectionRef = useRef<() => void>(() => {});
  const restoreRef = useRef<(bookIds: string[]) => void>(() => {});
  const removeFromSelectionRef = useRef<(bookId: string) => void>(() => {});
  const drawFurtherReadingRef = useRef<(frBooks: AnnotatedBook[]) => void>(() => {});
  const focusBookRef = useRef<(bookId: string) => void>(() => {});

  const selectedBookIds = useMemo(() => new Set(selectedBooks.map((b) => b.id)), [selectedBooks]);

  const handleRemoveFromSelection = useCallback((book: Book) => {
    removeFromSelectionRef.current(book.id);
  }, []);

  const handleFurtherReading = useCallback((frBooks: AnnotatedBook[]) => {

    drawFurtherReadingRef.current(frBooks);
  }, []);

  const handleClearFurtherReading = useCallback(() => {
    drawFurtherReadingRef.current([]);
  }, []);

  const handleFocusBook = useCallback((bookId: string) => {
    focusBookRef.current(bookId);
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const handleSave = useCallback((questions: QuestionCandidate[], chosenIndex: number | null, furtherReading: AnnotatedBook[] | null) => {
    const entry: SavedConstellation = {
      id: Date.now().toString(36),
      savedAt: new Date().toISOString(),
      bookIds: selectedBooks.map((b) => b.id),
      bookCovers: selectedBooks.map((b) => b.coverUrl ?? null),
      bookTitles: selectedBooks.map((b) => b.title),
      questions,
      chosenQuestionIndex: chosenIndex,
      furtherReading: furtherReading,
    };
    setSavedEntries((prev) => {
      const key = entry.bookIds.slice().sort().join(",");
      const idx = prev.findIndex(
        (e) => e.bookIds.slice().sort().join(",") === key
      );
      let next;
      if (idx >= 0) {
        next = [...prev];
        next[idx] = { ...entry, id: prev[idx].id };
      } else {
        next = [entry, ...prev];
      }
      localStorage.setItem("ibi_gallery", JSON.stringify(next));
      return next;
    });
    showToast("Saved to gallery");
  }, [selectedBooks, showToast]);

  const handleDelete = useCallback((id: string) => {
    setSavedEntries((prev) => {
      const next = prev.filter((e) => e.id !== id);
      localStorage.setItem("ibi_gallery", JSON.stringify(next));
      return next;
    });
  }, []);

  const handleRestore = useCallback((entry: SavedConstellation) => {
    setGalleryOpen(false);
    setDetailBook(null);
    setRestoredQuestions(entry.questions);
    setRestoredChosenIndex(entry.chosenQuestionIndex);
    setRestoredFurtherReading(entry.furtherReading);
    setTimeout(() => {
      restoreRef.current(entry.bookIds);
      setPanelOpen(true);
    }, 300);
  }, []);

  useEffect(() => {
    if (!canvasRef.current || books.length === 0) return;
    const el = canvasRef.current;
    const W = el.clientWidth;
    const H = el.clientHeight;

    const app = new PIXI.Application({
      width: W, height: H, backgroundColor: 0x000000,
      antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true,
    });
    el.appendChild(app.view as HTMLCanvasElement);
    const canvas = app.view as HTMLCanvasElement;

    const vp = new Viewport({
      screenWidth: W, screenHeight: H,
      worldWidth: WORLD_W, worldHeight: WORLD_H,
      events: app.renderer.events,
    });
    app.stage.addChild(vp);
    vp.drag().pinch().wheel({ smooth: 5 }).decelerate({ friction: 0.93 })
      .clampZoom({ minScale: ZOOM_MIN, maxScale: ZOOM_MAX });

    const withYear = books.filter((b) => b.year != null);
    const yMin = withYear.length ? Math.min(...withYear.map((b) => b.year!)) - 5 : 1900;
    const yMax = withYear.length ? Math.max(...withYear.map((b) => b.year!)) + 5 : 2025;

    // Guide lines
    const mainBottom = TRACK_DIVIDER_Y * WORLD_H;
    const guides = new PIXI.Graphics();
    const dStart = Math.floor(yMin / 10) * 10;
    const dEnd = Math.ceil(yMax / 10) * 10;
    for (let d = dStart; d <= dEnd; d += 10) {
      const wx = yearToWX(d, yMin, yMax);
      guides.lineStyle(1, 0xffffff, d % 100 === 0 ? 0.06 : 0.02);
      guides.moveTo(wx, 0); guides.lineTo(wx, mainBottom);
    }
    guides.lineStyle(1, 0xffffff, 0.08);
    guides.moveTo(0, mainBottom); guides.lineTo(WORLD_W, mainBottom);
    vp.addChild(guides);

    const trackLabel = new PIXI.Text("year unknown", {
      fill: "#F5F0E6", fontSize: 11, fontFamily: "Switzer, sans-serif",
      letterSpacing: 1.2, fontStyle: "italic",
    });
    trackLabel.alpha = 0.3;
    trackLabel.position.set(WORLD_W * MARGIN + 10, mainBottom + 12);
    vp.addChild(trackLabel);

    const dotTex = makeDotTexture(app.renderer);
    const dotTexW = DOT_TEX_RADIUS * 2;

    const dotContainer = new PIXI.Container();
    const coverContainer = new PIXI.Container();
    const labelContainer = new PIXI.Container();
    const selGfx = new PIXI.Graphics();
    const frGfx = new PIXI.Graphics();
    const frLabelContainer = new PIXI.Container();
    vp.addChild(dotContainer);
    vp.addChild(coverContainer);
    vp.addChild(labelContainer);
    vp.addChild(selGfx);
    vp.addChild(frGfx);
    vp.addChild(frLabelContainer);

    const selected: NodeData[] = [];

    const nodes: NodeData[] = books.map((book) => {
      const noYear = book.year == null;
      let wx: number, wy: number;
      if (noYear) {
        wx = (MARGIN + book.x * (1 - 2 * MARGIN)) * WORLD_W;
        wy = (TRACK_TOP + book.y * (TRACK_BOT - TRACK_TOP)) * WORLD_H;
      } else {
        wx = yearToWX(book.year!, yMin, yMax);
        wy = book.y * TRACK_DIVIDER_Y * WORLD_H;
      }
      const hasColor = !!book.dominantColor;
      const tint = bookTint(book.dominantColor);

      const dotSprite = new PIXI.Sprite(dotTex);
      dotSprite.anchor.set(0.5);
      dotSprite.position.set(wx, wy);
      dotSprite.tint = tint;
      dotSprite.alpha = 0;
      dotContainer.addChild(dotSprite);

      return {
        book, dotSprite, coverSprite: null,
        wx, wy, tint, hasColor, noYear, selected: false,
        coverTex: null, coverLoading: false, label: null,
      };
    });

    // --- Hit-testing: screen coords → nearest node ---
    function hitTest(screenX: number, screenY: number): NodeData | null {
      const worldX = vp.left + screenX / vp.scale.x;
      const worldY = vp.top + screenY / vp.scale.x;
      const z = vp.scale.x;
      const px = screenSize(z);

      let best: NodeData | null = null;
      let bestDist = Infinity;

      for (const n of nodes) {
        const dx = (n.wx - worldX) * z;
        const dy = (n.wy - worldY) * z;
        const dist = Math.sqrt(dx * dx + dy * dy);

        const cMul = n.hasColor ? 1.0 : 0.5;
        const tMul = n.noYear ? TRACK_SIZE_MUL : 1.0;
        const radius = Math.max((px * cMul * tMul) / 2, HIT_RADIUS_MIN);

        if (dist <= radius && dist < bestDist) {
          best = n;
          bestDist = dist;
        }
      }
      return best;
    }

    // --- Tooltip ---
    let hoveredNode: NodeData | null = null;

    function updateTooltip(n: NodeData | null, sx: number, sy: number) {
      const tip = tooltipRef.current;
      if (!tip) return;
      if (!n) {
        if (hoveredNode) { hoveredNode = null; tip.style.display = "none"; canvas.style.cursor = ""; }
        return;
      }
      canvas.style.cursor = "pointer";
      if (n.selected) {
        hoveredNode = n;
        tip.style.display = "none";
        return;
      }
      hoveredNode = n;
      const b = n.book;
      let html = `<span style="font-family:'Switzer',sans-serif;font-weight:700;font-size:14px;color:#F5F0E6;line-height:1.3">${b.title}</span>`;
      const metaParts: string[] = [];
      if (b.author) metaParts.push(b.author);
      if (b.year != null) metaParts.push(String(b.year));
      if (metaParts.length > 0) html += `<br><span style="font-family:'Geist Mono',monospace;font-size:13px;color:#B8B0A4;letter-spacing:0.02em">${metaParts.join(' · ')}</span>`;
      tip.innerHTML = html;
      tip.style.display = "block";
      const pad = 14;
      let x = sx + pad, y = sy - pad - 30;
      if (x + 230 > W) x = sx - 230 - pad;
      if (y < 10) y = sy + pad;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    }

    // --- Selection: remove-only ref for DetailPanel button ---
    removeFromSelectionRef.current = (bookId: string) => {
      const node = nodes.find((n) => n.book.id === bookId);
      if (!node || !node.selected) return;
      node.selected = false;
      const idx = selected.indexOf(node);
      if (idx >= 0) selected.splice(idx, 1);
      setRestoredQuestions(null);
      setSelectedBooks(selected.map((nd) => nd.book));
      applyZoom();
    };

    function drawSelection() {
      selGfx.clear();
      if (selected.length === 0) return;
      const z = vp.scale.x;
      const px = screenSize(z);

      for (const n of selected) {
        const cMul = n.hasColor ? 1.0 : 0.5;
        const tMul = n.noYear ? TRACK_SIZE_MUL : 1.0;
        const bPx = px * cMul * tMul * SEL_SIZE_BOOST;
        const halfW = bPx / (2 * z);
        let halfH = halfW;
        if (n.coverTex) halfH = halfW * (n.coverTex.height / n.coverTex.width);

        const ow = 2.5 / z;
        selGfx.lineStyle(ow, SEL_COLOR, 0.9);
        selGfx.drawRect(n.wx - halfW - ow, n.wy - halfH - ow,
          (halfW + ow) * 2, (halfH + ow) * 2);
      }

      if (selected.length >= 2) {
        const lw = 1.5 / z;
        selGfx.lineStyle(lw, SEL_COLOR, 0.55);
        for (let i = 0; i < selected.length; i++) {
          for (let j = i + 1; j < selected.length; j++) {
            selGfx.moveTo(selected[i].wx, selected[i].wy);
            selGfx.lineTo(selected[j].wx, selected[j].wy);
          }
        }
      }
    }

    // --- Canvas-level mouse events for hover + click ---
    let pointerDownPos: { x: number; y: number } | null = null;

    function onPointerDown(e: PointerEvent) {
      pointerDownPos = { x: e.offsetX, y: e.offsetY };
    }

    function onPointerUp(e: PointerEvent) {
      if (!pointerDownPos) return;
      const dx = e.offsetX - pointerDownPos.x;
      const dy = e.offsetY - pointerDownPos.y;
      pointerDownPos = null;
      if (dx * dx + dy * dy > 36) return;

      const hit = hitTest(e.offsetX, e.offsetY);
      if (hit) {
        if (hit.selected) {
          hit.selected = false;
          const idx = selected.indexOf(hit);
          if (idx >= 0) selected.splice(idx, 1);
          setRestoredQuestions(null);
          setSelectedBooks(selected.map((nd) => nd.book));
          setDetailBook((prev) => (prev?.id === hit.book.id ? null : prev));
          applyZoom();
        } else {
          if (selected.length < MAX_SELECTED) {
            hit.selected = true;
            selected.push(hit);
            setRestoredQuestions(null);
            setSelectedBooks(selected.map((nd) => nd.book));
            applyZoom();
          }
          const z = vp.scale.x;
          const px = screenSize(z);
          const cMul = hit.hasColor ? 1.0 : 0.5;
          const tMul = hit.noYear ? TRACK_SIZE_MUL : 1.0;
          const bPx = px * cMul * tMul;
          const sx = (hit.wx - vp.left) * z;
          const sy = (hit.wy - vp.top) * z;
          setDetailAnchor({ x: sx - bPx / 2, y: sy - bPx / 2, w: bPx, h: bPx });
          setDetailBook(hit.book);
          setPanelOpen(false);
          setGalleryOpen(false);
        }
        updateTooltip(hit, e.offsetX, e.offsetY);
      }
    }

    function onPointerMove(e: PointerEvent) {
      const hit = hitTest(e.offsetX, e.offsetY);
      updateTooltip(hit, e.offsetX, e.offsetY);
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointermove", onPointerMove);

    // --- Clear all / ESC / restore ---
    function clearAll() {
      for (const n of selected) n.selected = false;
      selected.length = 0;
      setSelectedBooks([]);
      setPanelOpen(false);
      setDetailBook(null);
      setRestoredQuestions(null);
      setRestoredChosenIndex(null);
      setRestoredFurtherReading(null);
      frAnnotations = [];
      frFadeTarget = 0;
      if (!frFadeRAF) frFadeRAF = requestAnimationFrame(animateFrFade);
      applyZoom();
    }
    clearSelectionRef.current = clearAll;

    restoreRef.current = (bookIds: string[]) => {
      for (const n of selected) n.selected = false;
      selected.length = 0;
      for (const id of bookIds) {
        const node = nodes.find((n) => n.book.id === id);
        if (node) { node.selected = true; selected.push(node); }
      }
      setSelectedBooks(selected.map((n) => n.book));
      if (selected.length >= 2) {
        const xs = selected.map((n) => n.wx);
        const ys = selected.map((n) => n.wy);
        const pad = 400;
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
        const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
        const zoom = Math.min(vp.screenWidth / w, vp.screenHeight / h);
        vp.scale.set(Math.max(Math.min(zoom, ZOOM_MAX), ZOOM_MIN));
        vp.moveCenter(cx, cy);
      } else if (selected.length === 1) {
        vp.moveCenter(selected[0].wx, selected[0].wy);
      }
      applyZoom();
      renderScale();
    };

    // --- Further-reading overlay ---
    let frAnnotations: AnnotatedBook[] = [];
    const frBadges: PIXI.Text[] = [];
    let frFadeAlpha = 0;
    let frFadeTarget = 0;
    let frFadeRAF = 0;

    function drawFurtherReading() {
      frGfx.clear();
      for (const badge of frBadges) {
        frLabelContainer.removeChild(badge);
        badge.destroy();
      }
      frBadges.length = 0;

      if (frAnnotations.length === 0 || frFadeAlpha < 0.01) return;

      const z = vp.scale.x;
      const px = screenSize(z);
      const alpha = frFadeAlpha;

      for (let i = 0; i < frAnnotations.length; i++) {
        const fr = frAnnotations[i];
        const node = nodes.find((n) => n.book.id === fr.id);
        if (!node) continue;

        const cMul = node.hasColor ? 1.0 : 0.5;
        const tMul = node.noYear ? TRACK_SIZE_MUL : 1.0;
        const bPx = px * cMul * tMul;
        const halfW = bPx / (2 * z);
        let halfH = halfW;
        if (node.coverTex) halfH = halfW * (node.coverTex.height / node.coverTex.width);

        // Thin gold outline
        const ow = 1.5 / z;
        frGfx.lineStyle(ow, FR_COLOR, FR_OUTLINE_ALPHA * alpha);
        frGfx.drawRect(node.wx - halfW - ow, node.wy - halfH - ow,
          (halfW + ow) * 2, (halfH + ow) * 2);

        // Dashed line to parent
        const parent = nodes.find((n) => n.book.id === fr.parent_book_id);
        if (parent) {
          frGfx.lineStyle(1 / z, FR_COLOR, FR_LINE_ALPHA * alpha);
          const dx = parent.wx - node.wx;
          const dy = parent.wy - node.wy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const dashLen = 12 / z;
          const gapLen = 8 / z;
          const steps = Math.floor(dist / (dashLen + gapLen));
          for (let s = 0; s < steps; s++) {
            const t0 = (s * (dashLen + gapLen)) / dist;
            const t1 = Math.min((s * (dashLen + gapLen) + dashLen) / dist, 1);
            frGfx.moveTo(node.wx + dx * t0, node.wy + dy * t0);
            frGfx.lineTo(node.wx + dx * t1, node.wy + dy * t1);
          }
        }

        // Numeric badge
        const badge = new PIXI.Text(String(i + 1), {
          fill: "#e8b547", fontSize: 11, fontFamily: "Geist Mono, monospace",
          fontWeight: "bold",
        });
        badge.anchor.set(0.5);
        badge.position.set(node.wx + halfW + 8 / z, node.wy - halfH - 4 / z);
        badge.scale.set(1 / z);
        badge.alpha = alpha;
        frLabelContainer.addChild(badge);
        frBadges.push(badge);
      }
    }

    function animateFrFade() {
      if (Math.abs(frFadeAlpha - frFadeTarget) < 0.01) {
        frFadeAlpha = frFadeTarget;
        drawFurtherReading();
        frFadeRAF = 0;
        return;
      }
      frFadeAlpha += (frFadeTarget - frFadeAlpha) * 0.12;
      drawFurtherReading();
      frFadeRAF = requestAnimationFrame(animateFrFade);
    }

    drawFurtherReadingRef.current = (frBooks: AnnotatedBook[]) => {
      frAnnotations = frBooks;
      if (frBooks.length > 0) {
        frFadeTarget = 1;
      } else {
        frFadeTarget = 0;
      }
      if (!frFadeRAF) frFadeRAF = requestAnimationFrame(animateFrFade);
    };

    focusBookRef.current = (bookId: string) => {
      const target = nodes.find((n) => n.book.id === bookId);
      if (!target) return;

      const targetZoom = Math.max(vp.scale.x, 1.0);
      const startLeft = vp.left + vp.screenWidth / (2 * vp.scale.x);
      const startTop = vp.top + vp.screenHeight / (2 * vp.scale.x);
      const startZoom = vp.scale.x;
      const startTime = performance.now();
      const duration = 600;
      const tw = target.wx;
      const ty = target.wy;

      function animate() {
        const elapsed = performance.now() - startTime;
        const t = easeInOut(clamp01(elapsed / duration));
        const cx = startLeft + (tw - startLeft) * t;
        const cy = startTop + (ty - startTop) * t;
        const z = startZoom + (targetZoom - startZoom) * t;
        vp.scale.set(z);
        vp.moveCenter(cx, cy);
        applyZoom();
        renderScale();
        drawFurtherReading();
        if (elapsed < duration) requestAnimationFrame(animate);
      }
      requestAnimationFrame(animate);

      const z = targetZoom;
      const px = screenSize(z);
      const cMul = target.hasColor ? 1.0 : 0.5;
      const tMul = target.noYear ? TRACK_SIZE_MUL : 1.0;
      const bPx = px * cMul * tMul;
      const sx = (target.wx - vp.left) * z;
      const sy = (target.wy - vp.top) * z;
      setDetailAnchor({ x: sx - bPx / 2, y: sy - bPx / 2, w: bPx, h: bPx });
      setDetailBook(target.book);
    };

    // --- Initial view ---
    vp.fit();
    vp.moveCenter(WORLD_W / 2, WORLD_H / 2);

    let loadingCount = 0;

    function inView(n: NodeData): boolean {
      const b = vp.getVisibleBounds();
      return n.wx >= b.x - 300 && n.wx <= b.x + b.width + 300 &&
             n.wy >= b.y - 300 && n.wy <= b.y + b.height + 300;
    }

    function applyZoom() {
      const z = vp.scale.x;
      const px = screenSize(z);
      const coverRaw = (z - COVER_FADE_START) / (COVER_FADE_END - COVER_FADE_START);
      const coverT = easeInOut(clamp01(coverRaw));
      const titleRaw = (z - TITLE_FADE_START) / (TITLE_FADE_END - TITLE_FADE_START);
      const titleT = easeInOut(clamp01(titleRaw));

      for (const n of nodes) {
        const colorMul = n.hasColor ? 1.0 : 0.5;
        const trackMul = n.noYear ? TRACK_SIZE_MUL : 1.0;
        const selMul = n.selected ? SEL_SIZE_BOOST : 1.0;
        const basePx = px * colorMul * trackMul * selMul;
        const hasCover = n.coverTex != null;
        const effectiveCoverT = hasCover ? coverT : 0;

        const dotScale = basePx / (dotTexW * z);
        n.dotSprite.scale.set(dotScale);
        const dotBaseAlpha = n.hasColor ? 1.0 : 0.3;
        const trackAlpha = n.noYear ? TRACK_ALPHA_MUL : 1.0;
        n.dotSprite.alpha = dotBaseAlpha * trackAlpha * (1 - effectiveCoverT);
        n.dotSprite.tint = n.selected ? SEL_COLOR : n.tint;

        if (hasCover && effectiveCoverT > 0.005) {
          if (!n.coverSprite) {
            const cs = new PIXI.Sprite(n.coverTex!);
            cs.anchor.set(0.5);
            cs.position.set(n.wx, n.wy);
            cs.tint = 0xffffff;
            coverContainer.addChild(cs);
            n.coverSprite = cs;
          }
          const coverScale = basePx / (n.coverTex!.width * z);
          n.coverSprite.scale.set(coverScale);
          n.coverSprite.alpha = effectiveCoverT * (n.noYear ? TRACK_ALPHA_MUL : 1.0);
          n.coverSprite.visible = true;
        } else if (n.coverSprite) {
          n.coverSprite.visible = false;
        }

        if (hasCover && titleT > 0.005 && inView(n)) {
          const coverH = n.coverTex!.height * (basePx / (n.coverTex!.width * z)) * z;
          const labelY = n.wy + (coverH / 2 + 8) / z;
          if (!n.label) {
            const truncTitle = n.book.title.length > 28
              ? n.book.title.slice(0, 26) + "…" : n.book.title;
            const label = new PIXI.Text(truncTitle, {
              fill: "#F5F0E6", fontSize: 12,
              fontFamily: "Switzer, sans-serif", letterSpacing: 0.4,
            });
            label.anchor.set(0.5, 0);
            labelContainer.addChild(label);
            n.label = label;
          }
          n.label.scale.set(1 / z);
          n.label.position.set(n.wx, labelY);
          n.label.alpha = titleT;
        } else if (n.label) {
          labelContainer.removeChild(n.label);
          n.label.destroy();
          n.label = null;
        }
      }

      drawSelection();
      if (z >= COVER_LOAD_ZOOM) queueCovers();
    }

    async function queueCovers() {
      for (const n of nodes) {
        if (loadingCount >= MAX_CONCURRENT_LOADS) break;
        if (n.coverTex || n.coverLoading || !n.book.coverUrl || !inView(n)) continue;
        n.coverLoading = true;
        loadingCount++;
        loadCover(n);
      }
    }

    async function loadCover(n: NodeData) {
      try {
        const raw = n.book.coverUrl + "?w=256&fit=crop&auto=format";
        const url = proxyCoverUrl(raw);
        const tex = await PIXI.Assets.load<PIXI.Texture>({ src: url });
        n.coverTex = tex;
        applyZoom();
      } catch { /* keep dot */ } finally {
        n.coverLoading = false;
        loadingCount--;
        if (vp.scale.x >= COVER_LOAD_ZOOM) queueCovers();
      }
    }

    function renderScale() {
      const scaleEl = scaleRef.current;
      if (!scaleEl) return;
      const sw = vp.screenWidth;
      const leftW = vp.left;
      const rightW = leftW + sw / vp.scale.x;
      const leftY = wxToYear(Math.max(0, leftW), yMin, yMax);
      const rightY = wxToYear(Math.min(WORLD_W, rightW), yMin, yMax);
      const visibleYearSpan = rightY - leftY;
      let step = 10;
      if (visibleYearSpan > 200) step = 50;
      else if (visibleYearSpan > 100) step = 20;
      else if (visibleYearSpan < 20) step = 5;
      else if (visibleYearSpan < 10) step = 2;
      const s = Math.floor(leftY / step) * step;
      const e = Math.ceil(rightY / step) * step;
      let html = "";
      let lastSx = -Infinity;
      const minGap = 55;
      for (let yr = s; yr <= e; yr += step) {
        if (yr < yMin - 10 || yr > yMax + 10) continue;
        const wx = yearToWX(yr, yMin, yMax);
        const sx = (wx - vp.left) * vp.scale.x;
        if (sx >= -40 && sx <= sw + 40 && sx - lastSx >= minGap) {
          html += `<span class="year-label" style="left:${Math.round(sx)}px">${yr}</span>`;
          lastSx = sx;
        }
      }
      scaleEl.innerHTML = html;
    }

    vp.on("moved", () => { renderScale(); drawSelection(); drawFurtherReading(); });
    vp.on("zoomed", () => { applyZoom(); renderScale(); drawFurtherReading(); });

    const fadeStart = performance.now();
    const fadeIn = () => {
      const t = Math.min((performance.now() - fadeStart) / 2000, 1);
      for (const n of nodes) {
        const base = n.hasColor ? t : t * 0.3;
        n.dotSprite.alpha = n.noYear ? base * TRACK_ALPHA_MUL : base;
      }
      if (t < 1) requestAnimationFrame(fadeIn);
      else applyZoom();
    };
    requestAnimationFrame(fadeIn);
    renderScale();

    const onResize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      app.renderer.resize(w, h);
      vp.resize(w, h);
      renderScale();
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointermove", onPointerMove);
      if (frFadeRAF) cancelAnimationFrame(frFadeRAF);
      app.destroy(true, { children: true, texture: true });
    };
  }, [books, showToast]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (detailBook) setDetailBook(null);
      else if (panelOpen) setPanelOpen(false);
      else if (galleryOpen) setGalleryOpen(false);
      else clearSelectionRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailBook, panelOpen, galleryOpen]);

  return (
    <div className="absolute inset-0 bg-black">
      <div ref={canvasRef} className="absolute inset-0" />

      <div
        ref={tooltipRef}
        className="absolute pointer-events-none z-20
                   bg-black/90 border border-white/10 rounded
                   px-3 py-2 max-w-[220px] shadow-lg leading-snug"
        style={{ display: "none" }}
      />

      {toast && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30
                        bg-black/90 border border-amber-500/30 rounded-lg
                        px-4 py-2 text-amber-200/90 text-sm font-sans font-medium
                        pointer-events-none">
          {toast}
        </div>
      )}

      <div
        ref={scaleRef}
        className="absolute bottom-0 left-0 right-0 h-7 pointer-events-none z-10
                   flex items-start bg-gradient-to-t from-black/60 to-transparent
                   border-t border-white/[0.04]"
      />

      {/* Clear selection button */}
      {selectedBooks.length >= 1 && !panelOpen && !galleryOpen && (
        <button
          onClick={() => clearSelectionRef.current()}
          className="absolute top-6 left-6 z-20
                     bg-black/70 border border-white/[0.1] rounded-full
                     px-4 py-1.5 text-secondary text-xs font-sans font-medium
                     tracking-wide hover:border-white/20 hover:text-star
                     transition-all duration-300 backdrop-blur-sm
                     flex items-center gap-1.5"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          clear selection
        </button>
      )}

      {/* Gallery button */}
      {!panelOpen && !galleryOpen && (
        <button
          onClick={() => { setGalleryOpen(true); setPanelOpen(false); setDetailBook(null); }}
          className="absolute top-6 right-6 z-20
                     bg-black/70 border border-white/[0.1] rounded-full
                     px-4 py-1.5 text-secondary text-xs font-sans font-medium
                     tracking-wide hover:border-white/20 hover:text-star
                     transition-all duration-300 backdrop-blur-sm
                     flex items-center gap-1.5"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="1" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
            <rect x="7" y="1" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
            <rect x="1" y="7" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
            <rect x="7" y="7" width="4" height="4" rx="0.5" stroke="currentColor" strokeWidth="1.1" />
          </svg>
          saved{savedEntries.length > 0 && ` (${savedEntries.length})`}
        </button>
      )}

      {/* Ask the library button */}
      {selectedBooks.length >= 2 && !panelOpen && !galleryOpen && (
        <button
          onClick={() => { setPanelOpen(true); setDetailBook(null); setGalleryOpen(false); }}
          className="absolute bottom-10 left-1/2 -translate-x-1/2 z-20
                     bg-black/80 border border-glow/40 rounded-full
                     px-5 py-2.5 text-glow text-sm font-sans font-medium
                     tracking-wide hover:border-glow hover:bg-black/90
                     transition-all duration-300 backdrop-blur-sm"
        >
          ask the library
        </button>
      )}

      <DetailPanel
        book={detailBook}
        open={detailBook != null}
        onClose={() => setDetailBook(null)}
        isSelected={detailBook ? selectedBookIds.has(detailBook.id) : false}
        onRemove={handleRemoveFromSelection}
        anchorX={detailAnchor.x}
        anchorY={detailAnchor.y}
        anchorW={detailAnchor.w}
        anchorH={detailAnchor.h}
      />

      <QuestionPanel
        books={selectedBooks}
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        preloadedQuestions={restoredQuestions}
        preloadedChosenIndex={restoredChosenIndex}
        preloadedFurtherReading={restoredFurtherReading}
        onSave={handleSave}
        onFurtherReading={handleFurtherReading}
        onClearFurtherReading={handleClearFurtherReading}
        onFocusBook={handleFocusBook}
      />

      <GalleryPanel
        entries={savedEntries}
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        onRestore={handleRestore}
        onDelete={handleDelete}
      />
    </div>
  );
}
