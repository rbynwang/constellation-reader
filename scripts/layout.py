"""
Stage 3 — Layout (time x semantic)
x-axis: publication year (normalized)
y-axis: 1D UMAP on combined embeddings (semantic position)
Books without publication_year placed in a separate track at y=0.92.
Output: data/coordinates.json as { book_id: [x, y] }
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import umap

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
EMBEDDINGS_FILE = DATA_DIR / "embeddings.npy"
INDEX_FILE = DATA_DIR / "embedding_index.json"
ENRICHED_FILE = DATA_DIR / "ibi_books_enriched.json"
OUTPUT_FILE = DATA_DIR / "coordinates.json"

YEAR_UNKNOWN_Y_BAND = 0.92
YEAR_UNKNOWN_Y_SPREAD = 0.06


def main():
    print("Stage 3 — Layout (time x semantic)")

    print("  Loading embeddings...")
    embeddings = np.load(EMBEDDINGS_FILE)
    print(f"  Shape: {embeddings.shape}")

    with open(INDEX_FILE, "r", encoding="utf-8") as f:
        index = json.load(f)

    if isinstance(index, dict):
        id_to_row = index
    else:
        id_to_row = {entry["id"]: entry["index"] for entry in index}

    row_to_id = {v: k for k, v in id_to_row.items()}

    with open(ENRICHED_FILE, "r", encoding="utf-8") as f:
        enriched = json.load(f)
    enriched_by_id = {b.get("_id", ""): b for b in enriched}

    ordered_ids = [row_to_id[i] for i in range(len(row_to_id))]

    years = []
    for bid in ordered_ids:
        book = enriched_by_id.get(bid, {})
        year = book.get("publication_year")
        years.append(year)

    has_year = sum(1 for y in years if y is not None)
    print(f"  Books with publication year: {has_year}/{len(ordered_ids)}")
    print(f"  Books without year: {len(ordered_ids) - has_year}")

    print("  Running 1D UMAP for semantic axis...")
    reducer = umap.UMAP(
        n_components=1,
        n_neighbors=15,
        min_dist=0.1,
        metric="cosine",
        random_state=42,
    )
    semantic_1d = reducer.fit_transform(embeddings).flatten()

    s_min, s_max = semantic_1d.min(), semantic_1d.max()
    semantic_norm = (semantic_1d - s_min) / (s_max - s_min)
    semantic_norm = semantic_norm * 0.85 + 0.05

    known_years = [y for y in years if y is not None]
    if known_years:
        year_min = min(known_years)
        year_max = max(known_years)
        print(f"  Year range: {year_min} - {year_max}")
    else:
        year_min, year_max = 1900, 2025
        print("  No publication years available — using semantic position for x-axis too")

    year_span = max(year_max - year_min, 1)

    coordinates = {}
    unknown_count = 0

    for i, bid in enumerate(ordered_ids):
        year = years[i]
        sem = float(semantic_norm[i])

        if year is not None:
            x = (year - year_min) / year_span
            x = x * 0.9 + 0.05
            y = sem
        else:
            if has_year == 0:
                x = sem
                y_2d = _get_2d_position(embeddings, i, semantic_1d)
                y = y_2d
            else:
                x = sem
                y = YEAR_UNKNOWN_Y_BAND + (unknown_count % 50) / 50 * YEAR_UNKNOWN_Y_SPREAD
                unknown_count += 1

        coordinates[bid] = [round(x, 6), round(y, 6)]

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(coordinates, f, indent=2, ensure_ascii=False)

    print(f"  Saved {len(coordinates)} coordinates to {OUTPUT_FILE}")
    print(f"    {has_year} placed by year x semantic")
    print(f"    {len(coordinates) - has_year} placed by semantic layout")

    _spot_check(coordinates, ordered_ids, enriched_by_id, years, year_min, year_max)
    print("\nDone.")


_umap_2d_cache = None


def _get_2d_position(embeddings, idx, semantic_1d):
    global _umap_2d_cache
    if _umap_2d_cache is None:
        print("  Running 2D UMAP (no years available, using both axes for semantic)...")
        reducer_2d = umap.UMAP(
            n_components=2,
            n_neighbors=15,
            min_dist=0.1,
            metric="cosine",
            random_state=42,
        )
        result = reducer_2d.fit_transform(embeddings)
        y_vals = result[:, 1]
        y_min, y_max = y_vals.min(), y_vals.max()
        _umap_2d_cache = (y_vals - y_min) / (y_max - y_min) * 0.85 + 0.05
    return float(_umap_2d_cache[idx])


def _spot_check(coordinates, ordered_ids, enriched_by_id, years, year_min, year_max):
    print("\n  Spot-check — nearest neighbors by position:")
    import random

    random.seed(42)
    sample = random.sample(range(len(ordered_ids)), min(5, len(ordered_ids)))

    all_coords = np.array([coordinates[ordered_ids[i]] for i in range(len(ordered_ids))])

    for idx in sample:
        bid = ordered_ids[idx]
        book = enriched_by_id.get(bid, {})
        title = book.get("title", "?")
        author = book.get("author", "?")
        cx, cy = coordinates[bid]

        dists = np.sqrt((all_coords[:, 0] - cx) ** 2 + (all_coords[:, 1] - cy) ** 2)
        nearest = np.argsort(dists)[1:6]

        print(f"\n    {title} by {author} ({cx:.3f}, {cy:.3f})")
        for ni in nearest:
            nb = enriched_by_id.get(ordered_ids[ni], {})
            nx, ny = all_coords[ni]
            print(f"      -> {nb.get('title', '?')[:50]} by {nb.get('author', '?')[:20]} ({nx:.3f}, {ny:.3f})")


if __name__ == "__main__":
    main()
