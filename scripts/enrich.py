"""
Stage 1 — Enrichment
Fills missing descriptions so embeddings have semantic content.
Pass 1: Google Books API by title + author.
Pass 2: Claude fallback for misses.
Output: data/ibi_books_enriched.json
"""

from __future__ import annotations

import json
import os
import time
import re
import asyncio
from pathlib import Path

import httpx
import anthropic
from dotenv import load_dotenv

load_dotenv()

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INPUT_FILE = DATA_DIR / "ibi_books_clean.json"
OUTPUT_FILE = DATA_DIR / "ibi_books_enriched.json"

GOOGLE_BOOKS_API_KEY = os.getenv("GOOGLE_BOOKS_API_KEY", "")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")

CLAUDE_MODEL = "claude-sonnet-4-6"


def load_books() -> list[dict]:
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def save_books(books: list[dict]):
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(books, f, indent=2, ensure_ascii=False)


async def google_books_lookup(
    client: httpx.AsyncClient, title: str, author: str | None
) -> dict | None:
    query = title
    if author:
        query += f"+inauthor:{author}"
    params = {"q": query, "maxResults": 1}
    if GOOGLE_BOOKS_API_KEY:
        params["key"] = GOOGLE_BOOKS_API_KEY

    try:
        resp = await client.get(
            "https://www.googleapis.com/books/v1/volumes", params=params
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("totalItems", 0) == 0:
            return None

        volume = data["items"][0]["volumeInfo"]
        result = {}
        if volume.get("description"):
            desc = volume["description"]
            desc = re.sub(r"<[^>]+>", "", desc)
            result["description"] = desc
            result["description_source"] = "google_books"
        if volume.get("categories"):
            result["subjects"] = volume["categories"]
        if volume.get("publishedDate"):
            raw_date = volume["publishedDate"]
            result["publishedDate"] = raw_date
            year_match = re.match(r"(\d{4})", raw_date)
            if year_match:
                result["publication_year"] = int(year_match.group(1))
        if volume.get("publisher"):
            result["publisher"] = volume["publisher"]
        return result if result.get("description") else None
    except Exception:
        return None


async def claude_description(
    client: anthropic.AsyncAnthropic, title: str, author: str | None
) -> str:
    author_str = author if author else "unknown author"
    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=500,
        messages=[
            {
                "role": "user",
                "content": (
                    f"Write a detailed factual description (150-200 words) of the book "
                    f'"{title}" by {author_str}. '
                    f"If you recognize the book, describe its subject matter, themes, "
                    f"scope, and significance in detail. Mention specific topics covered, "
                    f"the author's perspective or approach, and the book's place in its field. "
                    f"If you do not recognize the book, write the best description you can "
                    f"based on the title and author, covering what the book likely addresses, "
                    f"its probable themes, and its context within the relevant genre or discipline. "
                    f"Be specific rather than generic. "
                    f"Return only the description, no preamble."
                ),
            }
        ],
    )
    return message.content[0].text.strip()


async def enrich_batch_google(
    books: list[dict], batch_size: int = 10
) -> tuple[int, int]:
    hits = 0
    misses = 0
    async with httpx.AsyncClient(timeout=15.0) as client:
        for i in range(0, len(books), batch_size):
            batch = books[i : i + batch_size]
            tasks = []
            indices = []
            for j, book in enumerate(batch):
                if book.get("description"):
                    continue
                title = book.get("title", "")
                author = book.get("author")
                if not title:
                    continue
                tasks.append(google_books_lookup(client, title, author))
                indices.append(i + j)

            if not tasks:
                continue

            results = await asyncio.gather(*tasks)
            for idx, result in zip(indices, results):
                if result and result.get("description"):
                    books[idx]["description"] = result["description"]
                    books[idx]["description_source"] = "google_books"
                    if result.get("subjects"):
                        books[idx]["subjects"] = result["subjects"]
                    if result.get("publishedDate"):
                        books[idx]["publishedDate"] = result["publishedDate"]
                    if result.get("publication_year"):
                        books[idx]["publication_year"] = result["publication_year"]
                    if result.get("publisher"):
                        books[idx]["publisher"] = result["publisher"]
                    hits += 1
                else:
                    misses += 1

            progress = min(i + batch_size, len(books))
            print(f"  Google Books: {progress}/{len(books)} processed, {hits} hits so far")
            time.sleep(1.0)

    return hits, misses


async def enrich_batch_claude(books: list[dict], batch_size: int = 5) -> int:
    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    filled = 0

    needs_description = [
        (i, b) for i, b in enumerate(books) if not b.get("description") and b.get("title")
    ]

    for i in range(0, len(needs_description), batch_size):
        batch = needs_description[i : i + batch_size]
        tasks = []
        indices = []
        for idx, book in batch:
            tasks.append(claude_description(client, book["title"], book.get("author")))
            indices.append(idx)

        results = await asyncio.gather(*tasks, return_exceptions=True)
        for idx, result in zip(indices, results):
            if isinstance(result, str) and len(result) > 10:
                books[idx]["description"] = result
                books[idx]["description_source"] = "model"
                filled += 1

        progress = min(i + batch_size, len(needs_description))
        print(f"  Claude fallback: {progress}/{len(needs_description)} processed, {filled} filled so far")
        await asyncio.sleep(0.5)

    return filled


async def main():
    print("Stage 1 — Enrichment (detailed descriptions)")
    print(f"Loading books from {INPUT_FILE}")
    books = load_books()
    total = len(books)
    print(f"Loaded {total} books")

    for book in books:
        book.pop("description", None)
        book.pop("description_source", None)
        book.pop("subjects", None)
        book.pop("publishedDate", None)
    print("Cleared old descriptions — starting fresh")

    skip_google = os.getenv("SKIP_GOOGLE_BOOKS", "").lower() in ("1", "true", "yes")
    if skip_google:
        print("\nSkipping Google Books (SKIP_GOOGLE_BOOKS=1)")
        google_hits = 0
    else:
        print("\nPass 1: Google Books API...")
        google_hits, google_misses = await enrich_batch_google(books)
        print(f"Google Books: {google_hits} hits, {google_misses} misses")

    still_missing = sum(1 for b in books if not b.get("description"))
    print(f"\nStill missing descriptions: {still_missing}")

    if still_missing > 0:
        print("\nPass 2: Claude (150-200 word descriptions)...")
        claude_filled = await enrich_batch_claude(books)
        print(f"Claude: {claude_filled} filled")

    final_missing = sum(1 for b in books if not b.get("description"))
    final_have = sum(1 for b in books if b.get("description"))
    print(f"\nFinal: {final_have} with descriptions, {final_missing} without")
    print(f"  Google Books sourced: {sum(1 for b in books if b.get('description_source') == 'google_books')}")
    print(f"  Model sourced: {sum(1 for b in books if b.get('description_source') == 'model')}")

    avg_len = sum(len(b.get("description", "")) for b in books if b.get("description")) / max(final_have, 1)
    print(f"  Average description length: {avg_len:.0f} chars ({avg_len/5:.0f} words approx)")

    save_books(books)
    print(f"\nSaved to {OUTPUT_FILE}")


if __name__ == "__main__":
    asyncio.run(main())
