# Evaluation — Constellation Reader

## Prompt v4 → v5 Comparison (2026-04-27)

### Problems v5 fixes

| Problem | v4 | v5 |
|---------|----|----|
| **Repetitive "When..." opener** | 5/9 questions opened with "When" | 1/9 opened with "When"; 3/3 triples had 3 unique openers |
| **Overlong questions** | Avg 22 words (Triple B avg: 31) | Avg 15 words across all triples |
| **Forced cultural framing** | Triple A (nude photography craft) still invoked "Black sound" and postcolonial theory | Triple A stayed on photography craft — no cultural overlay |
| **Abstract noun phrases** | "the recording logic of mainstream media," "the resulting portrait owe that community" | Concrete subjects: camera, body, curator, garment, studio portrait |
| **Readability** | Several questions need 2 reads to parse (e.g. v4 Triple B Q3: 35 words, 2 embedded clauses) | All questions parseable in one pass |

### Opener variety (all 9 questions)

- **v4:** When, Does, When, When, How, If, When, Does, When → 3 unique forms
- **v5:** Does, What, If, When, Does, A, When, What, Spectacle → 5 unique forms

### What v5 does well

1. **Specificity without jargon.** v5 Triple A Q1 ("Does treating the body as sculptural form protect the model, or protect the photographer?") is concrete and direct. v4 equivalent was 23 words with nested clauses.
2. **Lets the books lead.** Triple C (fashion + music) — v4 imported "Black sound" into a triple where none of the books are about race. v5 stuck to spectacle, curation, and labor.
3. **Interpretations cite books by title.** v5 uses italicized titles consistently. v4 sometimes did, sometimes didn't.

### Potential new failure modes

1. **"Does X or Y?" binary** — v5 leans toward yes/no framing (3/9 questions are binary). These are still answerable in multiple directions, but the pattern could calcify with more runs.
2. **One "When..." still slipped through** in Triples B and C. The constraint is "at least 2 different openers across 3 questions," not "never use When." Acceptable but worth monitoring.
3. **Interpretations slightly longer** — v5 interpretations average ~5 sentences vs v4's ~4. Not a problem yet but could bloat.

### Verdict

v5 is a clear improvement on all three original complaints (monotone openers, over-abstraction, forced cultural framing). Ship it.

---

## Rubrics

### Question rubric (1–3 scale)

| Dimension | Question |
|---|---|
| **Threading** | Does the question genuinely hold all input books? |
| **Specificity** | Is the question grounded in actual book content, not generic? |
| **Non-flattening** | Does it preserve specificity of each book? |
| **Readability** | Can a literate adult parse it in one read? |
| **Generativity** | Does it invite thought, or is it rhetorical/closed? |

### Further-reading rubric (1–3 scale)

| Dimension | Question |
|---|---|
| **Relevance** | Does each book genuinely extend the question? |
| **Diversity** | Do the 3 books rotate the question across angles? |
| **Annotation accuracy** | Does each annotation correctly describe the book? |

### Passing threshold
- Triples scoring < 2.0 average are failures.

---

## Full test output

See [v5_test.md](v5_test.md) for side-by-side v4/v5 outputs on all 3 triples.
