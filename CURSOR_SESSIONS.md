# Cursor Session Prompts

A growing log of session prompts for use in Cursor or Claude Code. Each section is a paste-ready block. Open a fresh chat in the editor, paste the corresponding prompt, and let the model work from the README + the session prompt together.

The discipline of writing these out is intentional — it forces clear scope, explicit acceptance criteria, and an out-of-scope list. Resist the urge to ad-hoc your way through stages. Write the session prompt, paste it, work the session, then update this file with what was learned.

---

## Session 2 + 3 — Embeddings and Layout

**Goal:** implement Stages 2 and 3 from the README (embeddings and 1D semantic + 1D temporal layout). Produce a spot-check that proves the layout is meaningful before any frontend work begins.

**Out of scope:** frontend, API endpoints, anything in Stages 4 or beyond.

### Paste this into a fresh Cursor chat

```
Read README.md in full before writing any code. Pay particular attention to:
- §1 (what we are building)
- §2 (conceptual stance — load-bearing; every implementation choice should respect it)
- §5 Stages 2 and 3 (the work for this session)
- §15 (layout logic — explains why we chose 1D semantic + 1D time and not other options)

Goal of this session: implement Stages 2 and 3 — embeddings and layout. DO NOT
build the frontend, API endpoints, or anything in later stages.

Inputs (already produced by Stage 1):
- data/ibi_books_enriched.json
- Working set: ~1,800 books with coverUrl populated

Deliverables:

1. scripts/embed.py
   - For each book in the working set:
     - Text embedding on `title + " by " + author + ". " + description`
       using OpenAI text-embedding-3-large
     - Image embedding on cover via CLIP ViT-B/32 (use open_clip_torch —
       more stable on macOS than the openai/CLIP package)
     - Combined vector: weighted average, default 0.7 text / 0.3 image,
       configurable via env vars or CLI flags
   - Cache:
     - data/embeddings.npy — float32 array, shape (n_books, embedding_dim)
     - data/embedding_index.json — { book_id: row_index }
   - Resumable: if a book is already in the cache, skip it. Don't re-download
     covers we already have, don't re-embed text we already have.
   - Print progress (book counter and any errors). Don't fail the whole run
     on a single book error — log and continue.

2. scripts/layout.py
   - Load embeddings from data/embeddings.npy
   - UMAP on combined vectors → 1D semantic position (this becomes y-axis)
   - Normalize publication_year linearly → x-axis, with reasonable padding
     at start and end of range
   - Books with missing publication_year: place in a separate track at the
     bottom of the canvas. Make this configurable (also acceptable: exclude
     them from v1).
   - Output: data/coordinates.json as { book_id: [x, y] }

3. scripts/spotcheck.py
   - Matplotlib scatter plot of all books at their (x, y) coordinates
   - Color-code points by publication decade so temporal patterns are visible
   - Label ~20 random points with their titles (small font, transparent
     background so labels are readable but don't dominate)
   - Save to data/spotcheck.png at high enough resolution to be useful
   - In addition to the image: print to stdout 5 random books and their 5
     nearest neighbors in the layout, so we can sanity-check that nearby
     books actually feel related

Stack:
- Python 3.11+
- openai SDK (env var: OPENAI_API_KEY)
- open_clip_torch
- umap-learn
- numpy, matplotlib
- requirements.txt or pyproject.toml at the repo root

Acceptance criteria — do not declare done until ALL of these are met:
- spotcheck.png exists and shows interpretable structure (not random scatter)
- Walking up-down through a fixed time slice (e.g., 1990–2000) shows
  topical coherence vertically — books in similar y-positions feel related
- Books on similar topics from very different decades are far apart on x
  but close on y
- The 5-nearest-neighbors print output makes intuitive sense to a human
  reading it (similar books, similar era — not random books)

If the layout looks random or noisy: do NOT proceed to Stage 4. Debug here.
Common failure modes to investigate:
- Text embedding dominating completely → try lower text weight (0.5/0.5)
- CLIP failing on small or unusual cover images → log failures, consider
  a different model or fallback
- publication_year sparsity making the x-axis useless → check fill rate
  before normalizing
- UMAP parameters wrong → try adjusting n_neighbors and min_dist

After this session, I will manually inspect spotcheck.png. If the layout
is meaningful, we proceed to Stage 4. If not, we debug here before any
UI work.
```

### Notes after the session

*(Fill this in after running the session. What worked? What needed manual fixing? Any surprises?)*

---

## Session N — *(future sessions added here)*

*(One section per session as the project progresses.)*

---

## Session 4 — Frontend (Map · Selection · Question Flow · Gallery)

**Goal:** build the v1 frontend interface. Time × semantic constellation map with zoom-driven detail, click-to-select up to 3 books, AI question generation, further-reading flow with parent-line visualization, saved constellations gallery.

**This is a multi-phase session.** Five phases, each with its own acceptance criteria. Run phase by phase, demo each before continuing. Do not try to deliver everything in one shot — the iteration discipline is more important than speed, and an end-to-end app with phase 4 broken is much harder to debug than a phase 1 app working perfectly.

### Paste this into a fresh Cursor chat

```
PREREQUISITE: Make sure the Anthropic frontend-design skill is installed
and active in your environment. It steers Claude away from generic AI
frontend defaults (Inter + purple gradient + grid cards) toward distinctive
production-grade design. Install via: npx skills add anthropics/claude-code
--skill frontend-design (or use your editor's equivalent). The visual
identity guidance further down in this prompt is the project-specific
overlay; the skill handles the broader craft layer.

Read README.md in full before writing any code, especially:
- §1 (what we're building)
- §2 (conceptual stance — load-bearing)
- §4 (user flow — note the parent-line detail in step 6)
- §5 stages 5 and 6 (existing API endpoints you will call)
- §15 (layout logic)

Goal: build the v1 frontend. Five phases, work through them in order, demo
each before continuing.

OUT OF SCOPE
- Authentication / user accounts
- Mobile-optimized layout (desktop-first, ≥1280px assumed; mobile is v2)
- Server-side persistence (gallery is localStorage; constellations are
  URL-encoded)
- Onboarding tutorial / overlay (defer to v2)
- Animations beyond functional transitions (no idle motion)
- Anything not explicitly in the five phases below

INPUTS (already produced by previous sessions)
- public/data/ibi_books_enriched.json — book metadata
- public/data/coordinates.json — { book_id: [x, y] } positions
- API endpoints (Python FastAPI, deployed separately):
  - POST /api/questions — given 2-3 book IDs, returns 3 question candidates
    with interpretations
  - POST /api/extend — given chosen question + input book IDs, returns
    5 further-reading books with annotations and parent_book_id

ARCHITECTURE DECISIONS — locked, do not change without flagging

Frontend stack: React + Vite + TypeScript + Tailwind CSS.
Map rendering: PixiJS with pixi-viewport plugin. Purpose-built for 2D
zoom-pan at 1,800+ nodes. Avoid three.js (overkill), avoid SVG (perf),
avoid raw canvas (text complexity).
Data hosting: static JSON in /public, fetched on app mount. Cover images
served from Sanity CDN (already are).
Backend: existing FastAPI app, deployed separately. Frontend on Vercel.
State sharing: constellations URL-encoded with lz-string compression.
Gallery: localStorage list of saved URL hashes. No DB.

═══════════════════════════════════════════════════════════════════════════
PHASE 1 — Project scaffolding + map view
═══════════════════════════════════════════════════════════════════════════

Set up React + Vite + TypeScript + Tailwind. Install pixi.js, pixi-viewport,
lz-string.

Build the map:
- Load /data/coordinates.json and /data/ibi_books_enriched.json on mount
- Render every book as a PixiJS Sprite/Graphic at its (x, y) coord
- Pan and zoom via pixi-viewport
- Three zoom tiers:
  - Low zoom: dots, 4-8px, color-coded by publication decade (gentle
    gradient — warm earth tones for older, cooler tones for newer; pick
    a defensible palette and document the choice)
  - Medium zoom: dots become small cover thumbnails (32-64px)
  - High zoom: covers larger (128px+) with title text appearing below
- Year scale at top of canvas, always visible, with decade labels
- Background: deep black (#000000 to #0A0A0A) — this aligns with IBI's
  existing visual metaphor of the constellation/galaxy. The black is
  load-bearing; it's the night sky the constellation reads against.
  See the VISUAL IDENTITY ANCHOR section below for full palette guidance.
- Books with no publication_year: render in a separate track at the
  bottom edge of the canvas, visually distinct (smaller, lower opacity)

Acceptance criteria:
- All ~1,800 books render at low zoom, no lag during pan/zoom
- Year scale reads correctly across the full timeline
- Zoom transitions between tiers feel clean, no jarring jumps
- High-zoom covers are actually loaded and visible (not placeholders)

Demo to me with a screenshot before moving to phase 2.

═══════════════════════════════════════════════════════════════════════════
PHASE 2 — Selection mechanic
═══════════════════════════════════════════════════════════════════════════

Add interaction:

Hover (any zoom): tooltip near cursor showing
- Title
- Author (if known)
- Year (if known)
- Place (if known) — formatted as "Setting: X" or "Written: X" per §15
Tooltip uses serif font for the title, smaller sans-serif for metadata.

Click: toggle selection.
- Selected books visually elevated: slightly larger, thin gold/amber
  outline (2-3px), preserved across all zoom tiers
- Selection cap of 3
- Click an already-selected book: deselects it
- Click a 4th book while 3 are selected: small inline toast — "max 3
  selected. Deselect a book to add another." Do NOT auto-replace; that
  confuses users.

Connecting lines:
- 2 selected: draw a thin line connecting them
- 3 selected: lines complete a triangle
- Lines are drawn in the same gold/amber as the selection outline
- Lines persist across pan/zoom — visible at all zoom levels, including
  when one or both endpoints are off-screen
- Line thickness scales subtly with zoom (don't let them disappear when
  zoomed way out)

Triangle completion (3rd click):
- Half-second pause to let the triangle visually land
- Then trigger the question panel slide-in (see phase 3)

Acceptance criteria:
- Selection state unambiguous at every zoom level
- Selection persists across pan/zoom — verifiable by selecting in 1960s,
  zooming out, panning to 2000s, zooming in, selecting again
- Lines draw correctly across the canvas including off-screen
- Toast appears on 4th click

═══════════════════════════════════════════════════════════════════════════
PHASE 3 — Question panel
═══════════════════════════════════════════════════════════════════════════

When 3 books are selected (or user manually triggers "ask the library"
with 2 — yes, allow 2):

Side panel slides in from the right:
- ~40% of viewport width
- Opaque content area on a translucent backdrop — the map remains
  visible at low contrast underneath (don't use pure overlay; user
  should still see their constellation while reading questions)
- Panel scrollable internally if content overflows

Panel content:

1. Header showing selected books — small cover thumbs + titles
2. "Asking the library..." loading state while POST /api/questions runs.
   Honest loading (actually waits for API; no fake spinner).
3. On response: render the three candidate questions, each with its
   interpretation paragraph. Each is a selectable card with subtle
   hover state.

Typography:
- Questions: serif (Source Serif Pro, EB Garamond, or similar
  transitional serif). Larger size — these are the headlines.
- Interpretations: same serif, body size, comfortable line-height
  (~1.5)
- UI chrome (book titles, buttons): sans-serif

Panel dismissal: X button in top-right closes the panel. Selection state
in the map is preserved — user can re-open the panel via an "ask the
library" button that appears when ≥2 books are selected.

Acceptance criteria:
- Panel slide-in transition is smooth
- Loading state honestly waits for the API, doesn't fake completion
- Three questions render with their full interpretations
- Map remains visible behind the translucent backdrop
- Closing the panel preserves selection
- Re-opening works

═══════════════════════════════════════════════════════════════════════════
PHASE 4 — Further-reading flow with parent lines
═══════════════════════════════════════════════════════════════════════════

When the user picks one of the three candidate questions:

Panel updates:
- Chosen question moves to top of panel, larger
- Below it: 5 further-reading book cards
- Each card: cover thumbnail (medium size) + title + author + year +
  1-2 sentence annotation explaining how this book extends the question

API call: POST /api/extend with chosen question + 3 input book IDs.
Response includes parent_book_id for each of the 5 books (server-side
computation — see README §5 Stage 6 step 4).

ON THE MAP — this is the spatial payoff of the project:
- The 5 further-reading books light up at their actual positions on the
  map (gentle pulse animation on appearance, then settle into a softer
  gold outline — distinct from the original 3 input books)
- Each of the 5 has a thin line connecting it to its parent input book
  (via parent_book_id)
- Lines are visually distinguishable from the original triangle:
  - Triangle lines (between 3 inputs): thicker, full opacity gold/amber
  - Parent lines (recommendation → input): thinner, lower opacity, same
    color or a slightly different complementary hue
- Result: a network of 3 thick triangle lines + 5 thin parent lines,
  legible without being visually overwhelming

Panel dismissal preserves the network on the map. User can pan/zoom to
read the spatial distribution — see how recommendations cluster around
specific inputs, see whether they span decades or stay close to the
original time range, etc.

Acceptance criteria:
- Recommendations light up at correct positions on the map
- Each recommendation has exactly one parent line, drawn to the
  semantically-closest input
- Network is legible — visual hierarchy between triangle lines and
  parent lines is clear
- Panel dismissal preserves the network

═══════════════════════════════════════════════════════════════════════════
PHASE 5 — Permanent URLs + gallery
═══════════════════════════════════════════════════════════════════════════

Once a constellation reaches the "question chosen + further reading
loaded" state, encode the full state into a URL hash.

State shape to encode:
{
  inputBookIds: [string, string, string?],
  questionsCandidates: [{ question, interpretation, ... }, ...],
  chosenQuestionIndex: number,
  furtherReading: [
    { book_id, annotation, parent_book_id }, ...
  ]
}

Encoding: JSON.stringify, then lz-string compress to URI-safe base64.
URL format: `/#/c/<encoded>`

On URL change (including initial page load):
- If hash matches the constellation pattern, decode and restore full
  state
- Map renders with the input books selected, network drawn,
  recommendations lit up
- Panel opens with the chosen question + further reading already shown

If decoded URL exceeds typical browser limits (~2000 chars), warn but
still attempt — it should fit comfortably under for v1 data sizes,
but log encoded length and revisit if it becomes a problem.

Save mechanism:
- "Save to gallery" button in the question panel (only visible when a
  question has been chosen)
- On save: write to localStorage under key 'ibi_gallery'
- Saved entry shape:
  {
    id: <hash slug>,
    url: <full URL hash>,
    title: <truncated chosen question, 60 chars>,
    inputBookCovers: [<3 coverUrls>],
    savedAt: ISO timestamp
  }

Gallery view:
- Small "saved constellations" button in a corner of the canvas
  (top-right, low-key)
- Click opens a panel/modal listing saved entries
- Each entry shows: 3 input book covers thumbnailed, the chosen
  question text, the timestamp
- Click an entry: navigates to its URL, restoring that constellation
- Each entry has a small trash icon to delete

Acceptance criteria:
- Sharing a URL on a fresh browser session reproduces the exact
  constellation state
- Saving works without any backend
- Gallery view loads previous constellations correctly
- Deletion removes from localStorage and from the visible list

═══════════════════════════════════════════════════════════════════════════
VISUAL / TYPOGRAPHIC GUIDANCE (apply across all phases)
═══════════════════════════════════════════════════════════════════════════

VISUAL IDENTITY ANCHOR

The interface aligns visually with IBI's existing identity. IBI describes
itself using the metaphor of a constellation in the galaxy of the Black
Imagination — their existing IBI Digital product runs on this metaphor,
and the dark visual treatment is load-bearing, not decorative. The black
background is the night sky against which the constellation reads.

This project is a parallel exploration of IBI's archive — sympathetic to
but distinct from IBI Digital. Same visual vocabulary, different grammar:
where IBI Digital is gamified and puzzle-driven, this is spatial and
constellation-forming through user intent. The visual alignment makes
the conversation between the two products visible.

PALETTE

- Background: deep black, #000000 to #0A0A0A. Pure black at the canvas
  level; slightly off-black (#0A0A0A) acceptable for panel and chrome
  surfaces if differentiation is needed.
- Text primary: warm off-white, around #F5F0E6 — softens slightly
  against the black. Avoid pure white (#FFFFFF), it's too harsh.
- Text secondary: muted warm gray, around #B8B0A4, for metadata and
  annotations.
- Selection accent: warm gold / amber, around #E8B547 to #F5C842 —
  saturated enough to glow against the black, think candle flame or a
  star's core, not a highlighter.
- Decade gradient — STELLAR: older books in warm tones (deep amber
  → orange → red, like aged stars), newer books in cool tones
  (pale white → pale blue, like young hot stars). This mimics how
  stars age and gives a defensible reason for the direction of the
  gradient. Document the gradient with 5–7 stops keyed to decade
  boundaries.

DOT / COVER RENDERING ON BLACK

- Low zoom (dots, 4–8px): render with a slight glow/bloom so they read
  as stars rather than pixels. Color comes from the decade gradient.
- Medium zoom (32–64px thumbnails): cover images need a subtle dark
  border or vignette — most book covers were designed for light
  contexts and float awkwardly on pure black without one. A 1px warm
  gold border or a soft outer shadow grounds them.
- High zoom (128px+ covers with title): cover at full opacity, title
  in warm off-white serif beneath, small year/place metadata in muted
  gray below that.

LINES (selection triangle and parent lines)

- Triangle lines (between 3 input books): warm gold, full opacity,
  ~2px, with a slight glow.
- Parent lines (5 recommendations → input): warm gold, lower opacity
  (~50%), thinner (~1px), no glow. Visually subordinate to the
  triangle while clearly part of the same network.
- Lines should remain visible against the black even at low zoom —
  if they get lost, slightly increase opacity or add a faint glow.

TYPOGRAPHY

- Serif for questions and interpretations: a transitional serif that
  reads cleanly at body size on dark backgrounds. Consider Source
  Serif Pro, EB Garamond, or Cormorant. Test at multiple weights
  against the black — some serifs lose their edges on dark.
- Sans-serif for UI chrome (buttons, tooltips, gallery list): use a
  quiet sans like Inter, IBM Plex Sans, or Söhne. At UI sizes,
  sans-serif is more readable on black than serif.
- Question display size: 24–32px, comfortable line-height (~1.4).
- Interpretation body size: 16–18px, line-height ~1.6.
- Generous letter-spacing on smaller chrome text — black backgrounds
  can make tightly-spaced text harder to parse.

SPACING AND ANIMATION

- Whitespace generous; nothing crowded. The galaxy needs room to
  breathe.
- Animation discipline: only on transitions (selection, panel slide,
  network reveal). No idle motion. The map is not a screensaver, and
  motion against black draws disproportionate attention. Stillness is
  a value here — consistent with IBI's tone.
- The one exception: a very subtle, slow fade-in animation on initial
  load as books settle into the canvas. Not flashy. Two seconds, max.

═══════════════════════════════════════════════════════════════════════════
DEV WORKFLOW
═══════════════════════════════════════════════════════════════════════════

Build phase by phase. After each phase:
1. Run the app locally (npm run dev)
2. Verify all acceptance criteria for that phase
3. Stop and demo to me — screenshot or screen recording
4. Discuss issues, fix, then proceed to the next phase

If you run into a decision not specified above, surface it — don't
guess. Underdocumented decisions are how scope creeps and stances
drift.

═══════════════════════════════════════════════════════════════════════════
ANTI-PATTERNS TO AVOID
═══════════════════════════════════════════════════════════════════════════

- Don't add a sphere or rotation effect to the map — position is
  meaningful, rotation would erase that
- Don't put books on a circle — time runs left-to-right, not in a loop
- Don't add idle animation (drifting, pulsing, breathing) — stillness
  is the stance
- Don't generate or display content "about" the books beyond what the
  API returns. The frontend is a visual layer over a careful pipeline;
  don't add commentary, summaries, or interpretations the backend
  hasn't authored.
- Don't lazy-load the dataset's metadata — 1,800 books × ~1KB each is
  fine to bundle; the network round-trips would be worse than the
  bundle size
- Don't add user authentication, accounts, or DB — out of scope; v1 is
  URL-shareable and localStorage-persisted on purpose
```

### Notes after the session

*(Fill this in as phases complete. What worked? What needed rethinking? Any UX surprises?)*
