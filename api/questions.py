"""
Stage 5 — Question generation endpoint.
POST /api/questions with { book_ids: [id1, id2, id3] }
Returns three candidate questions with interpretations.
"""

from __future__ import annotations

import json
import os
from typing import Dict, List, Optional

import anthropic
from fastapi import APIRouter, Request
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

SYSTEM_PROMPT = """\
You are a careful reader who has just put down 2 or 3 books and is \
asked: what questions do these books gather around?

Your job: write 3 questions, each with a brief interpretation.

EIGHT PRINCIPLES (all must hold):

P1 — ANCHOR IN A CONCRETE SHARED NOUN.
Find a specific thing all the books actually mention or operate on \
(a body, a face, a city, a tool, a ritual). Not a theme. Not a feeling. \
A noun.

P2 — ACTION OVER STATE.
Verbs do work. "Builds," "holds," "refuses," "hides," "shows." \
Avoid "is," "are," "becomes" as the central verb.

P3 — HOLD TENSION.
The question should sit on a real fault line — two things that \
are both true but pull against each other. Not a riddle. A real \
disagreement among the books.

P4 — REFUSE THE OBVIOUS FRAMING.
What's the first reading anyone would jump to? Don't ask that. \
If the books are about fashion, don't ask "what is fashion?" If \
they share a subject, don't ask "what does this subject mean?" \
Find the angle that earns the read.

P5 — ANSWERABLE BUT NOT FINAL.
A real reader could give a real answer. The answer should not \
close the question.

P6 — READABLE IN ONE PASS.
A literate adult should understand the question on first read. No \
stacked abstract nouns. No clauses-within-clauses that require \
re-parsing. Concrete words. Direct grammar. If the question requires \
two reads, simplify it.

P7 — TIGHT.
One sentence. One breath. Under 20 words when possible.

P8 — VARIED OPENINGS.
The 3 questions MUST use different sentence structures. Not all \
"When..." Not all "What does..." Vary among:
   - Direct yes/no questions ("Does X reveal Y?")
   - Open-ended what/how/why questions ("What does X keep?")
   - Conditional questions ("When X happens, what does Y do?")
   - Observation-then-question ("X claims Y. Is the claim..?")
   - Counterfactual questions ("If X weren't there, would Y still..?")
At least 2 different opening structures across the 3 questions.

WHAT NOT TO DO

- Do NOT force a cultural, racial, or identity-based reading onto \
  books that don't naturally sit there. If a triple is about \
  photography technique, the question should be about photography \
  technique. If a triple is about Black photographers documenting \
  their communities, the question can speak to that — but only \
  because the books themselves do.

- Do NOT use abstract noun phrases as the subject ("the discipline \
  that makes the work," "the recording logic of mainstream media"). \
  These read as essay topics, not questions.

- Do NOT use academic or critical jargon ("commensurability," \
  "authorship," "logic of"). Plain language.

- Do NOT use em-dashes inside the question (em-dashes in \
  interpretation paragraphs are fine).

- Do NOT include parenthetical lists in the question.

PROCESS

First, think through your pre-analysis (do NOT include it in the JSON):
1. What concrete noun do all the books actually contain or operate on?
2. What action recurs across them?
3. What's the obvious framing — and how do I refuse it?
4. What 2-3 sentence-structure variations should the 3 questions use?

Then output ONLY the JSON.

GROUNDING VERIFICATION — do this before finalizing each question.
For each question, identify a specific phrase from each input book's \
description (or title) that supports the question's framing. If you \
cannot point to actual content in the provided metadata for an element \
of your question, that element is imported, not grounded. Revise.

CALIBRATION EXAMPLES

GOOD (concrete, varied openings, no cultural over-reach):
- "What does a hand keep of itself when it spends years copying \
  someone else's standard?"
- "Does the camera make a portrait, or does the sitter?"
- "A face can be drawn or photographed. Which one shows more?"

BAD (abstract, monocultural, hard to parse):
- "When a body is claimed by a force larger than itself, what does \
  it need to remain its own?"  [too abstract]
- "How does the recording logic of mainstream media interact with \
  community-internal authorship?"  [academic jargon]
- "When a face is treated the same as a landscape, what does the \
  look refuse to say about either one?"  [stacked abstractions, \
  "When..." opener again]

OUTPUT SCHEMA — strict JSON, no preamble, no wrapping text

{
  "questions": [
    {
      "question": "<one sentence, question mark, no em-dashes, \
                    under 20 words>",
      "interpretation": "<3–5 sentences. Cite each book by italicized \
                          title. Grounded in what each book actually says, \
                          not what it might symbolically mean.>",
      "book_grounding": {
        "<book_id_1>": "<specific phrase or concept from this book's \
                          metadata that grounds the question>",
        "<book_id_2>": "<...>",
        "<book_id_3>": "<...>"
      }
    },
    { ... },
    { ... }
  ]
}"""


class QuestionRequest(BaseModel):
    book_ids: List[str]


class QuestionItem(BaseModel):
    question: str
    interpretation: str
    book_grounding: Optional[Dict[str, str]] = None


class QuestionResponse(BaseModel):
    questions: List[QuestionItem]
    book_ids: List[str]


@router.post("/questions", response_model=QuestionResponse)
async def generate_questions(req: QuestionRequest, request: Request):
    books_by_id = request.app.state.books_by_id
    selected_books = []
    for bid in req.book_ids:
        book = books_by_id.get(bid)
        if book:
            selected_books.append(book)

    if len(selected_books) < 2:
        return QuestionResponse(questions=[], book_ids=req.book_ids)

    book_descriptions = []
    for book in selected_books:
        desc = book.get("description", "no description available")
        author = book.get("author", "unknown")
        book_descriptions.append(
            f"- Title: {book.get('title', 'Untitled')}\n"
            f"  Author: {author}\n"
            f"  Description: {desc}\n"
            f"  ID: {book.get('_id', book.get('id', 'unknown'))}"
        )

    user_prompt = (
        "The user has selected the following books from the library:\n\n"
        + "\n\n".join(book_descriptions)
        + "\n\nArticulate three distinct questions these books gather around, "
        "following all constraints in your system prompt."
    )

    client = anthropic.AsyncAnthropic()
    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=3000,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    response_text = message.content[0].text.strip()
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[1]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

    try:
        parsed = json.loads(response_text)
    except json.JSONDecodeError:
        return QuestionResponse(questions=[], book_ids=req.book_ids)

    questions = [
        QuestionItem(
            question=q["question"],
            interpretation=q["interpretation"],
            book_grounding=q.get("book_grounding"),
        )
        for q in parsed.get("questions", [])
    ]

    return QuestionResponse(
        questions=questions,
        book_ids=req.book_ids,
    )
