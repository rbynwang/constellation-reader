# Question Generation Prompt — Evaluation

Methodology, results, and known limits for the LLM-driven question generation pipeline. This document is written to grow alongside the project and to function as a standalone artifact in the case study writeup.

## Methodology

Per-question scoring on a 1–3 scale across nine dimensions (P1–P7, V, T, C — see README §8). Pass threshold: 2.5+ average across P1–P7 and V, with T (threading) and C (citation/grounding) both at 3. A question that hallucinates content or doesn't hold all input books is a hard fail regardless of how good the rest looks.

Test triples designed to span easy-to-hard:

1. **Close affinity** — *Face of the Gods* + *Tell My Horse* + *Flash of the Spirit*. Sanity check.
2. **Cross-domain, body/spirit thread** — *The Body Is Not An Apology* + *Parable of the Sower* + *Face of the Gods*.
3. **Single author** — three Toni Morrison books. Should produce three distinct readings, not three near-duplicates.
4. **Thin content** — three random fashion monographs. Should still produce a real question, even if the question is more modest.
5. **Deliberately disparate** — photography + fashion + Black history book with no obvious thread.
6. **Cross-domain, two-of-three coherence** — *Divine Horsemen* + *Face of the Gods* + *Lena Horne: Revelations*.

Sample size is intentionally small. The eval is for failure-mode discovery, not statistical power. The output is a documented set of patterns the system handles well, and a documented set of patterns it doesn't.

## Iteration history

**v1 — base prompt.** Original draft from README §6. Produced generic questions with abstract subjects ("identity," "belonging"). Failed P1 (concrete anchoring) and P5 (generative answerability) routinely. *Outcome: revise.*

**v2 — five principles + pre-analysis.** Added P1–P5 and the pre-analysis chain-of-thought step (shared nouns, recurring actions, refused framing, candidate tensions). Resolved the abstract-subject failures. *"What practice does the body need to be a ground where something can land?"* passed all five principles on triple #2. *Outcome: continue testing on harder triples.*

**v3 — added P6 (legibility test).** Tested on diasporic-religion triple. Two of three questions used insider shorthand — *"when the body becomes a horse,"* *"when the altar travels across water"* — that required prior knowledge of the source books to read at all. Diagnosed as the model borrowing the books' specialized vocabulary as poetic shorthand. Added P6: questions must function as English for a reader who has not opened the source books. Specialized vocabulary moved to the interpretation field, where unpacking is the job. *Outcome: insider-shorthand failures resolved.*

**v4 — added P7 (tightness), FORMAT CONSTRAINTS, GROUNDING VERIFICATION.** Tested on cross-domain triple #2. Question Q1 introduced a *"performance/audience"* framing not present in any source book — diagnosed as ungrounded free-association from the pre-analysis. Three additions:
- P7 tightness principle (one-breath read, every word load-bearing).
- FORMAT CONSTRAINTS hard-banning em-dashes in questions (soft instructions had been partially ignored).
- GROUNDING VERIFICATION step requiring each question element to trace to specific phrases in book metadata, output as a `book_grounding` field.

*Outcome: ungrounded framings and em-dash recidivism both resolved.*

**v4 (current state).** Tested on cross-domain triple #6. Two of three questions strong (Q1 body/claim, Q3 face/disclosure). Q2 borderline — see "Documented limits" below.

## What "good" looks like

A passing question on a hard cross-domain triple, post-v4:

> *"When a body is claimed by a force larger than itself, what does it need to remain its own?"*

19 words. Concrete noun (body). Action-framed (claimed, remain). Tension (own vs. claimed). Refuses the obvious "Black body under threat" framing while still addressing it. Legible to a reader who hasn't read the source books — every word is common English. Tight enough to read aloud in one breath. Grounded: the model's `book_grounding` field cites Lwa-riding-the-devotee from Deren, traditions-rebuilt-across-the-Atlantic from Thompson, and the industry's-claim-on-Horne's-image from *Revelations* — all real phrases from real metadata.

This is the bar. Generated question quality should be measured against this concrete example, not against the abstract rubric alone.

## Documented limits

### Cross-domain triples with one outlier book

When two of three selected books share a strong thematic frame (e.g., diasporic religious practice) and the third is an outlier (e.g., a celebrity autobiography), the model occasionally produces a question that genuinely threads the cohering pair and stretches the outlier to fit.

**Symptom.** The outlier book's `book_grounding` citation is meaningfully vaguer or more abstract than the other two. The interpretation paragraph does strenuous rhetorical work to incorporate the outlier — recasting biographical material as "tradition," for example, when the source describes neither.

**Example.** Triple #6 Q2: *"When a tradition is rebuilt from new materials in a new place, is the thing it makes still a practice or already a memory?"* Threads Deren and Thompson well. Stretches *Revelations* (autobiography of personal disclosure) into a "tradition rebuilt" framing the book itself does not occupy. The grounding citation for *Revelations* is the generic *"candid, introspective account of her life,"* which doesn't actually support the practice/memory tension.

**Frequency.** ~1 of 3 questions on cross-domain hard triples (n=4 such triples, 12 questions, 4 stretched).

**Mitigation in v1 product.** The three-options design allows users to regenerate or pick a stronger alternative. The borderline question is rarely the only acceptable one in the set — the other two questions in this same triple were both strong. The user-facing experience absorbs the failure.

**Future work for v2.** A prompt variant that checks `book_grounding` symmetry — flagging when one book's grounding citation is significantly weaker than the others — and refuses or rewrites the asymmetric question. Worth an A/B test against the current prompt on a held-out triple set.

### Em-dash recidivism

Soft instructions to avoid em-dashes in v3 were partially ignored. v4 hard-banned them with categorical language (*"Zero. If you reach for one, restructure the sentence."*). Compliance is now near-perfect, but worth re-checking against new model releases — em-dash usage is a learned behavior the model returns to under prompt variation.

### Diminishing returns on prompt iteration

Across four iterations, each round resolved a distinct failure mode but introduced or surfaced a smaller one. The marginal quality gain from iteration 4 to a hypothetical iteration 5 is unlikely to justify the engineering time. Locking the prompt and shipping with documented limits is the right v1 move; further iteration is v2 work, ideally informed by real user data.

## Notes for the case study writeup

- The iteration discipline is itself the eval methodology. Document each version's failure mode, the prompt change that addressed it, and the next failure mode it revealed.
- The decision to lock the prompt at v4 rather than chase 3-of-3 perfection is a real PM tradeoff worth narrating: marginal LLM quality gains vs. engineering time vs. user-facing mitigation via the regenerate flow.
- The cross-domain outlier limit is a positive signal in interviews — most candidates pretend their AI works perfectly. Documenting where it doesn't, what you tried, and what you'd do next demonstrates exactly the kind of judgment senior AI PM roles want.
