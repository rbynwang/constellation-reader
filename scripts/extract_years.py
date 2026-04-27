"""
Extract publication years via Claude API.
Batches 10 books per call. Saves progress incrementally.
Marks year_source: "model" for Claude-inferred years.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import anthropic
from dotenv import load_dotenv

load_dotenv()

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INPUT_FILE = DATA_DIR / "ibi_books_enriched.json"
BATCH_SIZE = 10
MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

SYSTEM_PROMPT = """\
You are a bibliographic reference tool. Given a list of books (title and author), \
return the most likely first publication year for each one.

Rules:
- Return ONLY a JSON array of objects: [{"id": "...", "year": YYYY}, ...]
- If you are confident of the year, return it as an integer.
- If you are unsure but can estimate the decade, return your best guess.
- If you truly cannot determine even an approximate decade (e.g. the title \
  and author are too generic or unknown), return null for that entry.
- Do NOT guess wildly. A null is better than a wrong year.
- No commentary, no markdown fences, just the JSON array."""


def load_books() -> list[dict]:
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_books(books: list[dict]):
    with open(INPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(books, f, indent=2, ensure_ascii=False)


def needs_year(book: dict) -> bool:
    return book.get("publication_year") is None


def build_batch_prompt(batch: list[dict]) -> str:
    lines = []
    for b in batch:
        bid = b.get("_id", "")
        title = b.get("title", "Untitled")
        author = b.get("author", "unknown")
        lines.append(f'- ID: {bid} | Title: {title} | Author: {author}')
    return "Return the publication year for each book:\n\n" + "\n".join(lines)


def extract_years_batch(client: anthropic.Anthropic, batch: list[dict]) -> dict[str, int | None]:
    prompt = build_batch_prompt(batch)

    message = client.messages.create(
        model=MODEL,
        max_tokens=500,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
    )

    text = message.content[0].text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        if text.endswith("```"):
            text = text[:-3]

    results = json.loads(text)
    return {r["id"]: r.get("year") for r in results}


def main():
    print("Extracting publication years via Claude")
    books = load_books()

    missing = [b for b in books if needs_year(b)]
    print(f"  Total books: {len(books)}")
    print(f"  Missing year: {len(missing)}")

    if not missing:
        print("  All books already have years. Nothing to do.")
        return

    books_by_id = {b.get("_id", ""): b for b in books}
    client = anthropic.Anthropic()

    filled = 0
    errors = 0
    total_batches = (len(missing) + BATCH_SIZE - 1) // BATCH_SIZE

    for i in range(0, len(missing), BATCH_SIZE):
        batch = missing[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1

        try:
            results = extract_years_batch(client, batch)

            for b in batch:
                bid = b.get("_id", "")
                year = results.get(bid)
                if year is not None and isinstance(year, (int, float)):
                    year = int(year)
                    if 1400 <= year <= 2030:
                        books_by_id[bid]["publication_year"] = year
                        books_by_id[bid]["year_source"] = "model"
                        filled += 1
        except Exception as e:
            errors += 1
            if errors <= 5:
                print(f"    Error on batch {batch_num}: {e}")

        if batch_num % 20 == 0 or batch_num == total_batches:
            print(f"  {batch_num}/{total_batches} batches | {filled} years filled | {errors} errors")
            save_books(list(books_by_id.values()))

    save_books(list(books_by_id.values()))

    final_with_year = sum(1 for b in books_by_id.values() if b.get("publication_year"))
    print(f"\n  Done. {final_with_year}/{len(books)} books now have publication_year")
    print(f"  {filled} years extracted this run, {errors} batch errors")


if __name__ == "__main__":
    main()
