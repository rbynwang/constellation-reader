"""
Compare v4 vs v5 question generation on 3 triples.
Calls v4 via direct Anthropic API (with old prompt) and v5 via live server.
Outputs eval/v5_test.md.
"""

import asyncio
import json
import os
import httpx
import anthropic
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EVAL_DIR = Path(__file__).resolve().parent

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

books_data = json.load(open(DATA_DIR / "ibi_books_enriched.json"))
books_by_id = {b.get("_id", b.get("id", str(i))): b for i, b in enumerate(books_data)}

TRIPLES = [
    {
        "name": "A — Photography craft",
        "ids": ["Holder_01073", "Holder_00436", "Holder_01546"],
    },
    {
        "name": "B — Black portraiture",
        "ids": ["Holder_00707", "Holder_05023", "Holder_00316"],
    },
    {
        "name": "C — Fashion + music",
        "ids": ["Holder_00499", "Holder_00083", "Holder_01679"],
    },
]

V4_SYSTEM_PROMPT = """\
You are a careful reader of a curated library belonging to the Institute of \
Black Imagination — a collection spanning Black history, photography, fashion, \
music, art, diasporic religious traditions, world cultures, and design.

A user has selected 2–3 books from this library that struck them. Your task \
is to articulate three distinct questions these books gather around — \
questions the constellation poses, not answers it provides.

VOICE

Write in the register of a careful reader who has just put down all three \
books and is asking the question they are now sitting with. Not academic. \
Not casual. Not poetic for the sake of poetry. Quiet attention. A sharp \
friend asking what they noticed.

SEVEN PRINCIPLES — every question must obey all seven

1. ANCHOR IN A CONCRETE NOUN.
2. FRAME ACTION, NOT STATE.
3. HOLD A TENSION.
4. REFUSE THE OBVIOUS FRAMING.
5. ANSWERABLE BUT NOT FINAL.
6. LEGIBLE WITHOUT THE BOOKS.
7. TIGHTNESS.

FORMAT CONSTRAINTS — hard rules, no exceptions

- NO em-dashes in the question.
- NO parenthetical lists qualifying a noun.
- One sentence.
- Em-dashes ARE permitted in the interpretation.

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
      "interpretation": "<2–4 sentences referencing each input book by \
                          short title and explaining how the question \
                          reads each one>",
      "anchored_in_noun": "<which noun>",
      "anchored_in_tension": "<which tension>",
      "book_grounding": {"<id>": "<phrase>", ...}
    },
    { ... },
    { ... }
  ]
}"""


def build_user_prompt(book_ids):
    descs = []
    for bid in book_ids:
        book = books_by_id.get(bid, {})
        desc = book.get("description", "no description available")
        author = book.get("author", "unknown")
        descs.append(
            f"- Title: {book.get('title', 'Untitled')}\n"
            f"  Author: {author}\n"
            f"  Description: {desc}\n"
            f"  ID: {bid}"
        )
    return (
        "The user has selected the following books from the library:\n\n"
        + "\n\n".join(descs)
        + "\n\nArticulate three distinct questions these books gather around, "
        "following all constraints in your system prompt."
    )


async def run_v4(book_ids):
    client = anthropic.AsyncAnthropic()
    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=3000,
        system=V4_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": build_user_prompt(book_ids)}],
    )
    text = message.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3]
    return json.loads(text)


async def run_v5(book_ids):
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            "http://localhost:8000/api/questions",
            json={"book_ids": book_ids},
        )
        resp.raise_for_status()
        return resp.json()


def format_questions(data, version):
    lines = []
    qs = data.get("questions", [])
    for i, q in enumerate(qs):
        lines.append(f"**Q{i+1}:** {q['question']}")
        lines.append(f"")
        lines.append(f"> {q['interpretation']}")
        lines.append(f"")
    return "\n".join(lines)


def word_count(q):
    return len(q.split())


def starts_with(q):
    return q.split()[0] if q else "?"


async def main():
    md_lines = ["# v4 vs v5 Question Generation Comparison\n"]

    for triple in TRIPLES:
        name = triple["name"]
        ids = triple["ids"]
        book_titles = [books_by_id.get(bid, {}).get("title", bid)[:60] for bid in ids]

        md_lines.append(f"## Triple {name}\n")
        md_lines.append(f"Books:")
        for bid, title in zip(ids, book_titles):
            md_lines.append(f"- `{bid}`: *{title}*")
        md_lines.append("")

        print(f"Running triple {name}...")

        # Run v4 and v5 in parallel
        v4_result, v5_result = await asyncio.gather(
            run_v4(ids),
            run_v5(ids),
        )

        # v4 output
        md_lines.append("### v4 output\n")
        v4_qs = v4_result.get("questions", [])
        for i, q in enumerate(v4_qs):
            opener = starts_with(q["question"])
            wc = word_count(q["question"])
            md_lines.append(f"**Q{i+1}** ({wc} words, opens with \"{opener}\"):")
            md_lines.append(f"  {q['question']}\n")
            md_lines.append(f"> {q['interpretation']}\n")

        # v5 output
        md_lines.append("### v5 output\n")
        v5_qs = v5_result.get("questions", [])
        for i, q in enumerate(v5_qs):
            opener = starts_with(q["question"])
            wc = word_count(q["question"])
            md_lines.append(f"**Q{i+1}** ({wc} words, opens with \"{opener}\"):")
            md_lines.append(f"  {q['question']}\n")
            md_lines.append(f"> {q['interpretation']}\n")

        # Quick analysis
        md_lines.append("### Analysis\n")
        v4_openers = [starts_with(q["question"]) for q in v4_qs]
        v5_openers = [starts_with(q["question"]) for q in v5_qs]
        v4_wcs = [word_count(q["question"]) for q in v4_qs]
        v5_wcs = [word_count(q["question"]) for q in v5_qs]

        md_lines.append(f"| Metric | v4 | v5 |")
        md_lines.append(f"|--------|----|----|")
        md_lines.append(f"| Openers | {', '.join(v4_openers)} | {', '.join(v5_openers)} |")
        md_lines.append(f"| Avg words | {sum(v4_wcs)/len(v4_wcs):.0f} | {sum(v5_wcs)/len(v5_wcs):.0f} |")
        v4_unique = len(set(v4_openers))
        v5_unique = len(set(v5_openers))
        md_lines.append(f"| Unique openers | {v4_unique}/3 | {v5_unique}/3 |")
        md_lines.append("")
        md_lines.append("---\n")

    output_path = EVAL_DIR / "v5_test.md"
    with open(output_path, "w") as f:
        f.write("\n".join(md_lines))
    print(f"Written to {output_path}")


if __name__ == "__main__":
    asyncio.run(main())
