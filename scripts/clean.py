"""
Stage 0 — Data cleaning
Normalizes author names, trims titles, flags duplicates and data errors.
Input:  data/ibi_books.json
Output: data/ibi_books_clean.json (cleaned version used by enrich.py)
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from collections import Counter

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INPUT_FILE = DATA_DIR / "ibi_books.json"
OUTPUT_FILE = DATA_DIR / "ibi_books_clean.json"


def normalize_author(raw: str | None) -> str:
    if not raw or not raw.strip():
        return ""

    name = raw.strip()

    name = re.sub(r"[.,;]+$", "", name).strip()

    if name.lower() == "multi":
        return "Multiple Authors"

    if "," in name:
        parts = [p.strip() for p in name.split(",", 1)]
        if len(parts) == 2 and parts[1]:
            last, first = parts
            if not any(c.isdigit() for c in first):
                name = f"{first} {last}"

    words = name.split()
    normalized = []
    for word in words:
        if word in ("van", "von", "de", "del", "di", "le", "la", "el", "al"):
            normalized.append(word)
        elif word.isupper() and len(word) > 2:
            normalized.append(word.capitalize())
        elif word[0].islower() and len(word) > 1:
            normalized.append(word[0].upper() + word[1:])
        else:
            normalized.append(word)
    name = " ".join(normalized)

    name = re.sub(r"\s{2,}", " ", name).strip()
    return name


def normalize_title(raw: str | None) -> str:
    if not raw or not raw.strip():
        return ""
    return re.sub(r"\s{2,}", " ", raw.strip())


def find_duplicate_covers(books: list[dict]) -> dict[str, list[str]]:
    url_to_ids: dict[str, list[str]] = {}
    for b in books:
        url = b.get("coverUrl")
        if url:
            url_to_ids.setdefault(url, []).append(b["_id"])
    return {url: ids for url, ids in url_to_ids.items() if len(ids) > 1}


def find_duplicate_titles(books: list[dict]) -> dict[str, list[str]]:
    title_to_ids: dict[str, list[str]] = {}
    for b in books:
        t = b.get("title_clean", b.get("title", "")).lower()
        if t:
            title_to_ids.setdefault(t, []).append(b["_id"])
    return {t: ids for t, ids in title_to_ids.items() if len(ids) > 1}


def main():
    print("Stage 0 — Data Cleaning")
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        books = json.load(f)
    print(f"Loaded {len(books)} books")

    author_changes = 0
    title_changes = 0
    empty_titles = 0

    for book in books:
        orig_author = book.get("author", "")
        clean_author = normalize_author(orig_author)
        if clean_author != (orig_author or ""):
            author_changes += 1
        book["author_original"] = orig_author
        book["author"] = clean_author

        orig_title = book.get("title", "")
        clean_title = normalize_title(orig_title)
        if not clean_title:
            empty_titles += 1
        if clean_title != (orig_title or ""):
            title_changes += 1
        book["title_clean"] = clean_title
        if clean_title:
            book["title"] = clean_title

    print(f"\nAuthor normalization: {author_changes} names changed")
    print(f"Title normalization: {title_changes} titles trimmed")
    print(f"Empty titles: {empty_titles}")

    print("\n--- Author samples ---")
    samples = [(b["author_original"], b["author"]) for b in books if b["author_original"] != b["author"]][:10]
    for orig, clean in samples:
        print(f"  '{orig}' -> '{clean}'")

    unique_authors = Counter(b["author"] for b in books if b["author"])
    print(f"\nUnique authors (after normalization): {len(unique_authors)}")
    print("Top 10:")
    for author, count in unique_authors.most_common(10):
        print(f"  {author}: {count}")

    dup_covers = find_duplicate_covers(books)
    if dup_covers:
        print(f"\n--- Duplicate cover URLs ({len(dup_covers)} sets) ---")
        for url, ids in dup_covers.items():
            titles = [next(b["title"] for b in books if b["_id"] == bid) for bid in ids]
            print(f"  {ids}: {titles}")

    dup_titles = find_duplicate_titles(books)
    print(f"\n--- Duplicate titles ({len(dup_titles)} groups) ---")
    for title, ids in list(dup_titles.items())[:15]:
        authors = [next((b["author"] for b in books if b["_id"] == bid), "") for bid in ids]
        print(f"  '{title}': {list(zip(ids, authors))}")
    if len(dup_titles) > 15:
        print(f"  ... and {len(dup_titles) - 15} more groups")

    has_cover = sum(1 for b in books if b.get("coverUrl"))
    has_author = sum(1 for b in books if b.get("author"))
    has_title = sum(1 for b in books if b.get("title"))
    print(f"\n--- Final fill rates ---")
    print(f"  title:    {has_title}/{len(books)} ({has_title/len(books)*100:.1f}%)")
    print(f"  author:   {has_author}/{len(books)} ({has_author/len(books)*100:.1f}%)")
    print(f"  coverUrl: {has_cover}/{len(books)} ({has_cover/len(books)*100:.1f}%)")

    holder = [b for b in books if b["_id"].startswith("Holder_")]
    talley = [b for b in books if b["_id"].startswith("Talley_")]
    print(f"\n  Holder: {len(holder)} books, {sum(1 for b in holder if b.get('coverUrl'))} with covers")
    print(f"  Talley: {len(talley)} books, {sum(1 for b in talley if b.get('coverUrl'))} with covers")

    for book in books:
        book.pop("title_clean", None)
        book.pop("author_original", None)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(books, f, indent=2, ensure_ascii=False)
    print(f"\nSaved cleaned data to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
