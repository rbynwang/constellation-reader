# Constellation Reader *(working title)*

**An AI reading interface for the Institute of Black Imagination's library.**

> Status: In development — Reimagining Museums seminar, Harvard GSD, Spring 2026.
> Project name: TBD with IBI. Working title only; do not commit to it.

---

## 1. What we are building

A web-based interface for IBI's library catalog (~3,400 books, ~1,800 with cover images) that turns browsing into reading. The user sees the collection laid out as a constellation map where position is determined by visual and semantic similarity. They select 2–3 books that struck them. The AI offers **three candidate questions** that the books gather around, each with a short interpretation showing how the question reads each input book. The user picks one. The chosen question becomes a center, and the AI surfaces 5 further books from the library that extend the question, each with a brief annotation grounded in the book's metadata.

The constellation is regenerable. The same three books, asked again, yield different questions. Different selections yield different constellations. The interface is a generator, not a catalog.

---

## 2. Conceptual stance — read this before any implementation choice

The project's defensibility rests on the stance below. Do not compromise it for a "more generative" feature, a flashier output, or a cleverer demo. The stance *is* the product.

**The archive is not retrospective; it is a seedbed.** Most archive interfaces treat the collection as past tense — a record of what has been read. This interface treats the library prospectively: the latent material from which the next acts of imagination emerge.

**The AI does not author Black culture.** It does two narrowly-scoped things: (1) articulate questions that are already present across selected books, and (2) extend curation by surfacing further reading from the existing library. It never generates new "Black artifacts," speculative cultural objects, fused syntheses, or content *about* Blackness. The library's contents remain themselves; the AI articulates threads and extends paths.

**Cultural commensurability is not assumed.** Three books from three lineages do not necessarily fuse. A *question* can hold tension across lineages without claiming they merge. This is why the output is a question (which the user answers) rather than a synthesis (which the AI authors).

**The user is the answerer.** The AI surfaces threads; the human builds meaning. This is the right ethical position for a non-community collaborator, and it is also more aligned with how IBI talks about imagination — as practice, ongoing, located in the person doing it.

**Legibility is a UX primitive.** The AI's interpretive move is made visible by offering three candidate questions rather than one. The user sees that an interpretation is being made, sees the alternatives, and chooses. This refuses the black-box aesthetic that makes most AI products feel extractive.

**Citation is structural, not decorative.** Every claim in any AI-generated text references a specific book ID from the dataset. No uncited assertions about what books say or contain. No "Beyond the archive" external content in v1.

If a feature, prompt, or UX decision violates one of these, do not ship it.

---

## 3. The dataset

Source files in repo:
- `data/ibi_books.json` — 3,383 entries
- `data/ibi_books.csv` — same data, CSV form

Fill rates across the dataset:

| Field | Fill rate |
|---|---|
| `title` | 99.7% |
| `author` | 79.1% |
| `coverUrl` | 53.2% |
| `description`, `tags`, `notes`, `isbn`, `collection`, `source`, `publishedAt` | **0.0%** |

Cover URLs point to IBI's Sanity CMS (`cdn.sanity.io/images/n4srpir9/test/...`).

**Working set for v1:** the ~1,800 books that have a cover image. Books without covers are deferred to v2 with a placeholder rendering, and called out in the writeup as a known scope decision.

**Enrichment is required.** The dataset has zero descriptions, so retrieval and embeddings will be weak without enrichment. See Stage 1 in the pipeline.

---

## 4. User flow

1. User lands on the constellation map. ~1,800 dots/thumbnails laid out in 2D.
2. User pans/zooms/drifts. Hovering reveals title and author.
3. User clicks 2–3 books. Selected books are visually marked.
4. User triggers "ask the library." Three candidate questions appear in a side panel, each with a 1–2 sentence interpretation that references each input book by name.
5. User picks one question. (Or regenerates, or edits — see open questions in §10.)
6. The view transitions: chosen question becomes center, 3 inputs cluster around it, 5 further-reading books bloom around the question, other books fade. Each further-reading book has a 1–2 sentence annotation showing how it extends the question. **On the map itself, each further-reading book lights up at its actual position, with a thin line connecting it to its semantically-closest input book (its "parent") — so the user can see spatially which input each recommendation extends.** The original 3-book triangle remains drawn, slightly thicker.
7. The constellation has a permanent, shareable URL.
8. User can reset and form a new constellation.

---

## 5. Pipeline architecture

Nine stages. Estimates assume one focused person.

### Stage 1 — Enrichment *(1–2 days)*

Fill the missing descriptions so embeddings have semantic content to work with.

- **Pass 1 — Google Books API.** Query by title + author. Pull description, subjects, publication year, and place of publication. Expected hit rate ~60–70%.
- **Pass 2 — Claude fallback.** For misses, generate a 40–60 word factual description from title + author. Mark `description_source: "model"` in the schema. **Never cite model-generated descriptions as the source for any user-facing claim.** Use them only for retrieval and clustering. Pass 2 does not infer publication_year or publication_place — books missing these fields are tagged and rendered without temporal/spatial context in the side panel.
- Output: `data/ibi_books_enriched.json` with title, author, coverUrl, description, description_source, publication_year, publication_place (when available from Google Books), optional subjects.

### Stage 2 — Embeddings *(half day)*

For each book in the working set:
- **Image embedding** — CLIP (OpenAI ViT-B/32 or similar) on the cover image.
- **Text embedding** — Voyage `voyage-3` or OpenAI `text-embedding-3-large` on `title + " by " + author + ". " + description`.
- **Combined vector** — weighted average favoring text (start at 0.7 text / 0.3 image, tune by inspection).
- Cache embeddings to disk (`data/embeddings.npy` + `data/embedding_index.json`).

### Stage 3 — Layout *(few hours)*

- UMAP on combined vectors → **1D semantic position** per book (y-axis).
- Normalize publication year → x-axis. Books with unknown year deferred to a separate track at the bottom or excluded from v1.
- Save to `data/coordinates.json` as `{book_id: [x, y]}`.
- **Spot-check before continuing.** Books from similar periods on similar topics should be close. Books from very different periods or topics should be far. If layout looks random, debug embeddings or year normalization here, not later. See §15 for full layout logic.

### Stage 4 — Constellation map frontend *(3 days, largest chunk)*

- WebGL (PixiJS or three.js) — DOM does not scale smoothly to ~1,800 nodes.
- Each book renders as either a small cover thumbnail or a dot at its (x, y).
- Pan, zoom, drift navigation.
- Hover state reveals title + author tooltip.
- Click to select. Selection cap of 3 enforced in UX.
- Selected state visually distinct.
- Trigger button: "ask the library" (final wording TBD).

### Stage 5 — Question generation *(1 day, but the most important day)*

This is the highest-leverage piece of engineering in the project. The prompt design determines whether the form sings or falls flat. **Build and test this prompt before building anything else around it.**

Endpoint: `POST /api/questions` with `{ book_ids: [id1, id2, id3] }`.

Pipeline:
1. Fetch full metadata (title, author, description, source) for each ID.
2. Call Claude with the prompt below.
3. Validate response is well-formed JSON with three questions.
4. Return to frontend.

See §6 for the actual prompt.

### Stage 6 — Question-aware retrieval and annotation *(1 day)*

When the user picks a question:
1. Embed the question text using the same text embedding model from Stage 2.
2. Retrieve top 20 nearest books from the library, excluding the inputs.
3. **LLM rerank**: pass the question + 20 candidates to Claude with prompt: *"Pick the 5 books from this list that genuinely extend the question — not just topically adjacent, but ones that rotate, deepen, or complicate the question. Return five IDs and a 1–2 sentence annotation per book showing how it extends the question. Cite by ID. Use only the metadata provided."*
4. **Compute parent for each chosen book.** For each of the 5 surfaced books, compute cosine similarity (in the same combined embedding space used for layout) to each of the 3 input books. The input with highest similarity is the book's `parent_book_id`. This powers the parent-line visualization in §4 step 6 — the user sees which input each recommendation extends.
5. Return chosen 5 + annotations + parent IDs.

### Stage 7 — Constellation visualization *(1–2 days)*

- View transitions when question is chosen.
- Question text rendered as center node, large.
- 3 input books cluster around question.
- 5 further-reading books appear with their covers + annotations.
- Other books fade or hide.
- Permanent shareable URL: `/constellation/<hash>` storing `(book_ids, chosen_question, further_reading_ids)`.
- *Stretch:* growing meta-archive of past constellations browsable as its own view.

### Stage 8 — Evaluation *(1 day, ongoing)*

The eval methodology is itself a portfolio artifact. Don't skip it.

- Pick 15–20 deliberate triples — some with clear thematic affinity, some deliberately disparate, some single-author, some cross-genre.
- Run the pipeline. Capture all three questions per triple, the picked further-reading lists.
- Hand-grade against rubric (§8).
- Document failure modes encountered.
- Summarize in `EVAL.md` for the writeup.

### Stage 9 — Writeup *(ongoing throughout build)*

Maintain in parallel with the build. Standard PM case-study format:

- Problem framing
- Primary user
- Product decisions and tradeoffs (including the rejected-direction memos in §9)
- Demo link
- Eval methodology and results
- Limits and known issues
- Future work (multi-modal expansion, podcast/essay/video integration, IBI partnership extensions)

This document is what hiring managers actually read.

---

## 6. The question generation prompt

Build this first. Iterate it 5–10 times against real triples in the Anthropic console *before* building Stages 4–7. If the prompt doesn't produce strong questions on hand-picked triples, the rest of the project doesn't matter.

**System prompt:**

```
You are a careful reader of a curated library belonging to the Institute of
Black Imagination — a collection spanning Black history, photography, fashion,
music, art, diasporic religious traditions, world cultures, and design.

A user has selected 2–3 books from this library that struck them. Your task
is to articulate three distinct questions these books gather around —
questions the constellation poses, not answers it provides.

VOICE

Write in the register of a careful reader who has just put down all three
books and is asking the question they are now sitting with. Not academic.
Not casual. Not poetic for the sake of poetry. Quiet attention. A sharp
friend asking what they noticed.

FIVE PRINCIPLES — every question must obey all five

1. ANCHOR IN A CONCRETE NOUN. Each question is built around a specific
   shared thing — body, altar, hand, threshold, hair, room, river, kitchen,
   voice, song, stitch, page, breath. Not an abstract concept (identity,
   belonging, freedom, experience). The thing must be present in the
   content of all three books, not imposed on them.

2. FRAME ACTION, NOT STATE. Use verbs of doing — practice, build, hold,
   carry, refuse, name, gather, return, keep, offer, become, witness.
   Avoid "is", "means", "represents". A question that asks what something
   IS produces a dictionary answer; a question that asks what something
   DOES produces thinking.

3. HOLD A TENSION. The question must put two things in relationship — a
   thing and what it does, a thing and what it resists, a thing and what
   it requires. Two ideas pulling against each other inside one sentence.
   A single-concept question does not generate thought.

4. REFUSE THE OBVIOUS FRAMING. When three books are clearly "about
   Blackness" or "about diaspora" or "about womanhood" or "about queerness",
   the question does NOT name those framings as its subject. The framing
   is the room the books are sitting in; the question must point at
   something inside the room. Do not produce questions like "what does it
   mean to be Black/diasporic/queer/embodied". These flatten specificity
   into category.

5. ANSWERABLE BUT NOT FINAL. A reader should be able to answer in several
   directions, and each answer should reveal more question. Not rhetorical,
   not closed, not an exam.

6. LEGIBLE WITHOUT THE BOOKS. The question must work as English for someone
   who has NOT read the source books. Every noun and metaphor in the
   question must be readable on its own — common-knowledge words, common
   images. Specialized vocabulary, source-specific metaphors, and book-
   internal shorthand belong in the INTERPRETATION, where they can be
   unpacked. They do NOT belong in the question itself.

   FAILS this principle:
   - "When the body becomes a horse, what does the person surrender?"
     (requires knowing that 'horse' is Vodou shorthand for the possessed body)
   - "When the altar crosses water, what does it give up?"
     (requires knowing 'water' is shorthand for the Middle Passage)
   - "What does the gaze hold when it refuses the camera's logic?"
     (requires knowing 'the gaze' as a specific theoretical term)

   PASSES this principle:
   - "When a hand builds an altar from new materials, is it practicing a
     philosophy or remembering one?"
     (every word readable on its own; deepens for readers of the books)
   - "What does a body need to keep being its own when it is asked to carry
     something else?"
     (works as English; deepens once you know about hyperempathy and possession)

   The test: would this question make sense to a thoughtful reader who has
   never opened any of these books? If no, rewrite. The question should
   deepen for an insider, but it must function for an outsider.

7. TIGHTNESS. Aim for questions that read aloud in one breath. If a word
   can be removed without changing what the question asks, remove it.
   Concrete images outperform abstract conditions; trust the reader to
   feel the weight of a short, sharp question rather than spelling
   everything out. Em-dashes that introduce lists of abstract objects
   are usually a sign the question is doing fatigue work.

   FAILS this principle:
   - "What does a body need to keep being its own when it is asked to
     carry something else — a community's grief, a tradition's continuity,
     another person's suffering?"
     (em-dash with three abstract objects is the model showing its work;
     the question can do the same work in fewer words)

   PASSES this principle:
   - "What does a body need to remain its own when it is asked to carry
     someone else's pain?"
     (same substance, tighter)
   - "When a hand builds an altar from new materials, is it practicing
     a philosophy or remembering one?"
     (clean, picturable, no extra words)

   The test: read the question aloud. If you run out of breath, lose words.
   If any clause can be removed without losing the question, remove it.

FORMAT CONSTRAINTS — hard rules, no exceptions

- NO em-dashes in the question. Zero. If you reach for one, restructure
  the sentence. Em-dashes are how models hedge; the question must commit.
- NO parenthetical lists qualifying a noun (e.g. "a tradition — religious,
  artistic, or commercial"). Pick one framing and commit to it.
- One sentence. Single clause preferred, two clauses maximum, cleanly
  joined.
- Em-dashes ARE permitted in the interpretation, where unpacking is the
  job. They are forbidden only in the question itself.

CRITICAL PROHIBITIONS

- You are NOT synthesizing the books into a fused whole. The books remain
  themselves. You articulate a thread that runs through them.
- You are NOT authoring claims about Black culture, Black experience, or
  any specific cultural tradition. You read what the books are about per
  their titles, authors, descriptions, and name what the books share.
- You do NOT assume cultural commensurability. If three books come from
  different lineages, your question holds the tension between them; it
  does not collapse them into a generic theme.
- You use ONLY the metadata provided. Do not assert content beyond title,
  author, and description.

PROCESS — follow this order in your output

First, in a `pre_analysis` field, do four things:

a) List the concrete nouns / sites / objects / materials that appear
   across all three books. Draw from titles and descriptions; be specific.
b) List the actions or practices that recur. Verbs from the descriptions,
   inferred from the titles.
c) Name the obvious flattening framing — the question an unthinking
   reader would generate. State it explicitly so you can refuse it.
d) Name 2–3 tensions that might hold all three books together — pairs
   of ideas pulling against each other.

Then, in a `questions` field, generate three distinct questions, each
anchored in one of the tensions and one of the concrete nouns. Each
question gets a 2–4 sentence interpretation that references each input
book by short title and explains how the question reads each one
specifically.

GROUNDING VERIFICATION — do this before finalizing each question

For each question, identify a specific phrase from each input book's
description (or title, if no description) that supports the question's
framing. If you cannot point to actual content in the provided metadata
for an element of your question, that element is imported, not grounded.
Revise the question.

FAILS grounding:
- Question: "When a face is built for an audience, what does the person
  behind it surrender?"
- Books: a self-love manifesto, a dystopian novel, a study of African
  diasporic altars
- Problem: "face built for an audience" is not in any of the three books.
  No description supports a performance/audience framing. The model has
  free-associated from the pre-analysis instead of reading the books.

PASSES grounding:
- Question: "When a hand builds an altar from new materials, is it
  practicing a philosophy or remembering one?"
- Books: includes Thompson on diasporic altars, includes a book on
  practiced traditions
- Grounding: Thompson's description discusses altar traditions adapted
  in new materials after displacement; the practice/memory tension is
  visibly present in the source content.

Every element of the question must trace back to actual book content.
If it does not, do not ship the question.

OUTPUT SCHEMA — strict JSON, no preamble

{
  "pre_analysis": {
    "shared_concrete_nouns": ["..."],
    "recurring_actions": ["..."],
    "obvious_framing_to_refuse": "...",
    "candidate_tensions": ["...", "...", "..."]
  },
  "questions": [
    {
      "question": "<one sentence ending in a question mark, no em-dashes>",
      "interpretation": "<2–4 sentences referencing each input book by
                          short title and explaining how the question
                          reads each one>",
      "anchored_in_noun": "<which noun from pre_analysis>",
      "anchored_in_tension": "<which tension from pre_analysis>",
      "book_grounding": {
        "<book_id_1>": "<short phrase from this book's description or
                          title that supports the question>",
        "<book_id_2>": "<...>",
        "<book_id_3>": "<...>"
      }
    },
    { ... },
    { ... }
  ]
}
```

**User prompt template:**

```
The user has selected the following books from the library:

[For each selected book:]
- Title: <title>
- Author: <author or "unknown">
- Description: <description or "no description available">
- ID: <book_id>

Articulate three distinct questions these books gather around, following all
constraints in your system prompt.
```

**Quality test triples for prompt iteration:**

Use these to develop the prompt before shipping. Mix is intentional:

1. *Face of the Gods* + *Tell My Horse* + *Flash of the Spirit* — close affinity, sanity check
2. *Beloved* + *Body Against Body* + *Face of the Gods* — cross-domain, harder to thread
3. Three random fashion monographs — should produce a thinner but still real question
4. One photography book + one fashion book + one Black history book — deliberately disparate
5. Three books by Toni Morrison — same author, should still produce three distinct readings, not three near-duplicates

The prompt is good when all five produce questions that pass the rubric in §8.

---

## 7. Tech stack

Defaults — change if you have a strong reason:

- **Backend:** Python 3.11+, FastAPI for endpoints. Anthropic Python SDK (`claude-opus-4-7` or `claude-sonnet-4-6` for cost).
- **Embeddings:** `voyage-3` (text) or OpenAI `text-embedding-3-large`; OpenAI CLIP for images. Sentence-transformers acceptable as fallback.
- **Layout:** `umap-learn` for dimensionality reduction.
- **Storage:** flat JSON files for v1; if growth becomes real, SQLite. No need for a vector DB at this scale — in-memory KNN over ~1,800 vectors is instant.
- **Frontend:** React + Vite. PixiJS or three.js for the canvas. Tailwind for styling.
- **Deployment:** Vercel for frontend, Fly.io or Railway for backend. Or run everything on Vercel with API routes if Python isn't required there.

**Cost note.** Each constellation is roughly 3 LLM calls (questions + rerank + annotations). At Claude Sonnet pricing this is on the order of cents per constellation — fine for demo. Mention scaling considerations (caching by sorted-book-ID hash, batched precomputation, distilled annotation model) in the writeup as future work.

---

## 8. Evaluation rubric

**For each generated question, score 1–3 across these dimensions:**

| # | Dimension | What you're checking |
|---|---|---|
| **P1** | Concrete anchoring | Is the question anchored in a specific shared noun (body, altar, hand, threshold, etc.)? Or is it abstract (identity, belonging, freedom, experience)? |
| **P2** | Action framing | Is it framed around a verb of doing (practice, build, hold, refuse)? Or is it asking "what is X"? |
| **P3** | Tension | Does it hold two ideas in relationship? Or is it a single-concept question? |
| **P4** | Refusal of flattening | Does it sidestep the obvious cultural framing? Or does it name the books' category as its subject ("what does diaspora mean", "what is Black embodiment", etc.)? |
| **P5** | Generative answerability | Can a reader answer in multiple directions? Does each answer reveal more? Or is it closed / rhetorical / dictionary-bound? |
| **P6** | Legibility without the books | Would this question make sense to someone who has not read the source books? Are all metaphors readable on their own, or do they depend on insider vocabulary? |
| **P7** | Tightness | Does it read aloud in one breath? Is every word load-bearing? Or is the model doing fatigue work — em-dash lists, redundant clauses, abstract conditions stacked on top of each other? |
| **V** | Voice | Is it in register — careful reader, sharp friend, quiet attention? Or academic / casual / over-poetic? |
| **T** | Threading | Does it genuinely hold all three books, or fit two well and one as an afterthought? |
| **C** | Citation accuracy & grounding | Does the interpretation correctly reference each book per its metadata? AND does each question's `book_grounding` field point to actual phrases in the provided descriptions, not free-association? A question that cannot ground every element in real book content is importing a frame the books do not contain — hard fail. |

**Pass threshold:** average of 2.5+ across P1–P7 and V, with T and C both at 3.

A question that hallucinates content (C < 3) or doesn't hold all three books (T < 3) is a hard fail regardless of how good the rest looks. Don't ship those.

**The pre-analysis is your debugging tool.** When a question fails, read the model's `pre_analysis` field:
- *Did it identify shared concrete nouns?* If not, P1 will fail at the source.
- *Did it identify them but not anchor questions in them?* P1 fails despite good pre-analysis — the prompt's anchoring instruction needs strengthening.
- *Did it correctly identify the obvious framing but fail to refuse it?* P4 needs reinforcement.
- *Did it identify good tensions but not use them?* P3 needs anchoring to tensions explicitly.
- *Does the question read as a riddle that requires insider knowledge?* P6 fails — the model has borrowed the books' specialized vocabulary as poetic shorthand. The fix is reinforcing P6's "legibility test" in the prompt: would a thoughtful reader who has never opened these books understand the question?
- *Does the question feel heavy or fatiguing despite being clear?* P7 fails — usually shows up as em-dash lists of abstract objects, or stacked conditional clauses. The fix is reading the question aloud in eval and noting the breath count; revise the prompt's tightness instruction if multiple questions across triples come back over-explained.
- *Does the question sound smart but reference framings not actually in the books?* C fails on grounding — the model has free-associated from its pre-analysis. Read the `book_grounding` field: if the cited phrases are vague or absent, the model is performing depth rather than reading the source. The fix is reinforcing the GROUNDING VERIFICATION step in the prompt with stronger language and more failure examples.

Patterns of failure across multiple triples = prompt revision. One-off failures = note and move on. Document recurring failure modes in `EVAL.md` — those notes are interview gold and the substance of your AI eval methodology section in the writeup.

**For the further-reading list, additional rubric:**

| Dimension | What you're checking |
|---|---|
| **Relevance** | Does each surfaced book actually extend the chosen question, or is it just topically adjacent? |
| **Diversity** | Do the 5 books rotate the question across angles, or do they repeat each other? |
| **Annotation accuracy** | Does each annotation correctly describe the book based on metadata? |

---

## 9. Decisions and rejected directions

Document these in the writeup. Rejected directions are PM signal.

**Rejected: 3D terrain layout.** No conceptual justification for the third dimension on a web target. 2D map with semantic layout is the honest move.

**Rejected: speculative artifact cards (museum-label form).** Asks the AI to author new cultural objects fused from three sources. Risks generic-diasporic flattening; assumes cultural commensurability the project explicitly refuses to assume; over-extends the AI's authorial scope. Replaced by question-articulation, which keeps the books themselves intact.

**Rejected: parallel cultural surfaces (ritual / meal / garment / room versions of one synthesis).** Same fusion problem at greater scale. Each surface is a synthetic claim by an AI that has no business making it.

**Rejected: cross-modal podcast/essay/video integration in v1.** Out of scope for one-week build. Architecture supports v2 expansion via additional embeddings on transcribed audio, scraped essay text, video stills.

**Rejected: AI-authored "Black futures" or speculative content.** Position concern. AI is not the right author for new content about Black experience or imagination.

**Rejected: "Beyond the archive" external context layer in v1.** Hallucination risk and engineering cost outweigh the benefit at this stage. Mention as future work.

**Rejected: single-question output.** Hides the AI's interpretive move. Three options surface the move and give the user authorship over which thread to follow.

**Naming:** Working title only. Final naming should happen with IBI, not unilaterally. Avoid words drawn from specific Black spiritual or cultural traditions (conjure, hoodoo, root, etc.) unless explicitly invited by IBI to use them.

---

## 10. Open questions to resolve before/during build

- **Question count.** Is three the right number of candidate questions? Two might force more decisive interpretations; four risks dilution. Default to three; A/B if time permits.
- **Further-reading count.** Five is intuitive but arbitrary. Test 3, 5, 7.
- **Selection size.** Hard cap at 3, or allow 2? Two might produce thinner questions; 4+ produces noise. Default: allow 2 or 3.
- **Regeneration policy.** Should users be able to ask for three new questions on the same triple? Yes — but with a cost note (it's another LLM call). Cache by triple to avoid repeat charges on identical regenerations.
- **Editable questions.** Should users be able to edit a question and re-run further reading on their version? Powerful but adds UX complexity. Defer to v2 unless time allows.
- **Books without covers.** Hide in v1 or render as text-only nodes? Default: hide, document, mention in writeup.

---

## 11. PM portfolio framing — what the case study foregrounds

Notes for the writeup. These are the things that distinguish this project from "art-school AI demo":

- **Knowing what to not generate.** Articulate, on demand: *we considered fused speculative artifacts and rejected them because they would flatten cultural specificity. We narrowed the AI's scope to articulating questions and extending curation, both of which it can do with citation discipline. Bias mitigation is the shape of the product, not a filter we added.*
- **Multi-stage LLM pipeline design.** Embed → layout → on-select retrieve → generate question candidates → user choice → question-aware rerank → annotate. Each stage with its own grounding/scoping decisions.
- **Legibility as UX primitive.** Three options rather than one makes the AI's interpretive move visible without exposing prompts.
- **Evaluation methodology for generative output.** Hand-graded rubric across dimensions, documented failure modes, recurring prompt issues. More rigor than 90% of student AI work.
- **Data enrichment as product judgment.** Google Books → Claude fallback, marking model-generated descriptions, refusing to cite them in user-facing claims.
- **Iteration story.** Rejected directions documented. Demonstrates judgment, not just execution.
- **Generalizability.** "Constellation reading for cultural archives" is a product pattern; IBI is the case study. Easy v2 narratives toward other archives or cultural domains.

---

## 12. Repository layout

```
.
├── README.md                    # this file
├── MOTIVATION.md                # the project's stance, in working-draft form
├── CURSOR_SESSIONS.md           # paste-ready prompts for each Cursor session
├── data/
│   ├── ibi_books.json
│   ├── ibi_books.csv
│   ├── ibi_books_enriched.json  # output of Stage 1
│   ├── embeddings.npy           # output of Stage 2
│   ├── embedding_index.json
│   └── coordinates.json         # output of Stage 3
├── scripts/
│   ├── enrich.py                # Stage 1
│   ├── embed.py                 # Stage 2
│   └── layout.py                # Stage 3
├── api/
│   ├── main.py                  # FastAPI app
│   ├── questions.py             # Stage 5 endpoint
│   └── extend.py                # Stage 6 endpoint
├── web/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ConstellationMap.tsx
│   │   │   ├── QuestionPanel.tsx
│   │   │   └── ConstellationView.tsx
│   │   └── ...
│   └── package.json
├── eval/
│   ├── triples.json             # the 15–20 test triples
│   ├── results.json
│   └── EVAL.md                  # eval methodology + findings
└── WRITEUP.md                   # PM case study, ongoing
```

---

## 13. Build order

1. **Day 1 morning:** prompt design (§6). Test against 5 triples in Anthropic console. Iterate until rubric passes.
2. **Day 1 afternoon — Day 2:** Stage 1 enrichment script. Run it. Verify output.
3. **Day 2 — Day 3 morning:** Stage 2 embeddings + Stage 3 layout. Spot-check clusters.
4. **Day 3 afternoon — Day 5:** Stage 4 frontend constellation map.
5. **Day 5 — Day 6:** Stage 5 question API + Stage 6 retrieval API.
6. **Day 6 — Day 7:** Stage 7 visualization transition + permanent URLs.
7. **Day 7:** Stage 8 eval. Stage 9 writeup polish.

Buffer assumed; real timeline likely 1.5x. If something slips, cut Stage 7's permanent URL feature first, then v2 stretch features.

---

## 14. Things to discuss with IBI before launch

- Final project name.
- Whether they want to be credited as partner / case study, and how.
- **Visual identity alignment.** The interface uses IBI's own visual vocabulary — black background, constellation/galaxy metaphor, stellar gradient — which is also the visual language of their existing IBI Digital product. This alignment makes the project read as conversation with their work rather than appropriation, but should be explicitly named in any conversation with them: this is sympathetic to IBI Digital, not a clone of it (different grammar — spatial and time × semantic vs. gamified and puzzle-driven), and credit/framing should reflect that.
- Whether the meta-archive of generated constellations should be public, private, or shared with IBI only.
- Scope boundaries — what use cases they would or wouldn't endorse.
- Any books, themes, or framings they would prefer not to be foregrounded by the algorithm.
- Whether they have additional data (descriptions, tags, podcast transcripts, essay text) that could be used for v2.

---

## 15. Layout logic

**The decision: time × semantic.** The map's x-axis is publication year; the y-axis is semantic position derived from text + image embeddings reduced to one dimension. Books move left-to-right through Black creative history; books move up-down by what they're about. Walking the map left-to-right is walking through time; walking up-down is walking through topic.

**Why time and not pure semantic clustering.** Pure 2D semantic clustering (the *All At Once* approach) is conceptually thin — it tells the reader nothing they couldn't have guessed from genre tags. Time as one axis gives the layout a felt logic: a topic isn't just a region, it has a trajectory. You can see how a concern evolves, recurs, or returns. The map teaches the reader something by being walked.

**Why not time × place as the two axes.** Place is harder than it looks. *Place of publication* is the cleanest metadata field but the least meaningful — Knopf is in New York whether the book is about Mississippi or Senegal. *Place that matters* (where the work is set, where the author was when writing, where the photograph was taken) is interpretive, sparsely available, and would force the LLM into judgment calls the project's stance otherwise refuses. Realistic coverage for "place that matters" is ~30–40%, with significant ambiguity even when present. Place is not a clean spatial axis at this dataset's scale.

**Place as panel context instead.** When a book is selected, its side panel surfaces year and known place — e.g., *"Year: 1979 · Setting: Cincinnati"* or *"Year: 1962 · Written: Paris"*. When a constellation forms, all three books' coordinates appear together: *"Brooklyn 1937, Mississippi 1955, Oakland 1971."* No interpretation. Just placed. The further-reading annotations include the coordinate as bare fact: *"Cleveland, 1978."* No commentary about what that place and time mean.

**Why this preserves the stance.** The interface gives coordinates, not significance. Cultural memory belongs to the reader; the project trusts they have it. This refuses both the curatorial impulse to explain Blackness to readers and the AI-flattening impulse to summarize history for them. The user does the cultural reading. The map stays out of the way.

**Implementation notes.**
- y-axis: reduce the combined text + image embedding to **one** dimension via UMAP. Spot-check that vertical neighbors share recognizable concerns within a fixed time slice.
- x-axis: normalized publication year, linear, with reasonable padding at start and end.
- Books with unknown publication year render in a separate "year unknown" track at the bottom, or are excluded from v1.
- Place data shown in panels is `publication_place` from Google Books for v1. Richer "place of significance" enrichment (where set, where written, where photographed) is v2 and would require interpretive LLM calls that need their own eval pass.
- The 1D semantic axis loses some structure compared to 2D — that's the trade-off. The gain is a layout that means something.

---

*This document is the working brief. Update it as decisions evolve. Treat the conceptual stance in §2 as load-bearing — every other section can be revised; that one shouldn't be.*
