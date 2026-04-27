"""
Stage 3b — Spot-check visualization
Scatter plot of all books at their layout coordinates, color-coded by decade.
Prints nearest-neighbor samples to stdout for manual verification.
Output: data/spotcheck.png
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import Normalize
from matplotlib.cm import ScalarMappable

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
COORDS_FILE = DATA_DIR / "coordinates.json"
ENRICHED_FILE = DATA_DIR / "ibi_books_enriched.json"
EMBEDDINGS_FILE = DATA_DIR / "embeddings.npy"
INDEX_FILE = DATA_DIR / "embedding_index.json"
OUTPUT_PNG = DATA_DIR / "spotcheck.png"


def main():
    print("Spot-check — generating layout visualization")

    with open(COORDS_FILE, "r", encoding="utf-8") as f:
        coordinates = json.load(f)

    with open(ENRICHED_FILE, "r", encoding="utf-8") as f:
        enriched = json.load(f)
    enriched_by_id = {b.get("_id", ""): b for b in enriched}

    with open(INDEX_FILE, "r", encoding="utf-8") as f:
        index = json.load(f)

    if isinstance(index, dict):
        id_to_row = index
    else:
        id_to_row = {entry["id"]: entry["index"] for entry in index}

    embeddings = np.load(EMBEDDINGS_FILE)

    book_ids = list(coordinates.keys())
    xs = []
    ys = []
    decades = []
    titles = []
    authors = []

    for bid in book_ids:
        x, y = coordinates[bid]
        xs.append(x)
        ys.append(y)
        book = enriched_by_id.get(bid, {})
        titles.append(book.get("title", "?"))
        authors.append(book.get("author", "?"))
        year = book.get("publication_year")
        if year:
            decades.append((year // 10) * 10)
        else:
            decades.append(None)

    xs = np.array(xs)
    ys = np.array(ys)

    known_decades = [d for d in decades if d is not None]
    has_decades = len(known_decades) > 0

    fig, ax = plt.subplots(figsize=(20, 14))
    fig.patch.set_facecolor("#0a0a0f")
    ax.set_facecolor("#0a0a0f")

    if has_decades:
        dec_min = min(known_decades)
        dec_max = max(known_decades)
        norm = Normalize(vmin=dec_min, vmax=dec_max)
        cmap = plt.cm.viridis

        for i, bid in enumerate(book_ids):
            if decades[i] is not None:
                color = cmap(norm(decades[i]))
                ax.scatter(xs[i], ys[i], c=[color], s=8, alpha=0.7)
            else:
                ax.scatter(xs[i], ys[i], c="gray", s=5, alpha=0.3)

        sm = ScalarMappable(cmap=cmap, norm=norm)
        sm.set_array([])
        cbar = fig.colorbar(sm, ax=ax, shrink=0.6, pad=0.02)
        cbar.set_label("Decade", color="white", fontsize=12)
        cbar.ax.yaxis.set_tick_params(color="white")
        plt.setp(cbar.ax.yaxis.get_ticklabels(), color="white")
    else:
        ax.scatter(xs, ys, c="#e8e4d9", s=8, alpha=0.5)
        ax.text(
            0.5, 0.02,
            "No publication years available — color-coding disabled",
            transform=ax.transAxes, ha="center", color="gray", fontsize=10,
        )

    random.seed(42)
    label_indices = random.sample(range(len(book_ids)), min(25, len(book_ids)))
    for idx in label_indices:
        label = titles[idx][:35]
        if len(titles[idx]) > 35:
            label += "..."
        ax.annotate(
            label,
            (xs[idx], ys[idx]),
            fontsize=5.5,
            color="#c9a87c",
            alpha=0.85,
            xytext=(6, 4),
            textcoords="offset points",
            bbox=dict(boxstyle="round,pad=0.2", fc="#0a0a0f", ec="none", alpha=0.7),
        )

    ax.set_title(
        f"Constellation Layout — {len(book_ids)} books",
        color="white", fontsize=16, pad=15,
    )
    if has_decades:
        ax.set_xlabel("Publication Year (normalized)", color="white", fontsize=11)
    else:
        ax.set_xlabel("Semantic Position (UMAP dim 1)", color="white", fontsize=11)
    ax.set_ylabel("Semantic Position (UMAP)", color="white", fontsize=11)
    ax.tick_params(colors="white")
    for spine in ax.spines.values():
        spine.set_color("#333")

    plt.tight_layout()
    plt.savefig(OUTPUT_PNG, dpi=200, facecolor="#0a0a0f")
    print(f"  Saved plot to {OUTPUT_PNG}")

    # --- Nearest-neighbor check ---
    print("\n  Nearest neighbors by embedding similarity:")
    all_coords = np.array([[coordinates[bid][0], coordinates[bid][1]] for bid in book_ids])

    sample_indices = random.sample(range(len(book_ids)), min(5, len(book_ids)))

    for idx in sample_indices:
        bid = book_ids[idx]
        row = id_to_row.get(bid)
        if row is None:
            continue

        vec = embeddings[row]
        dists = np.dot(embeddings, vec)
        nearest = np.argsort(-dists)[1:6]

        row_to_id = {v: k for k, v in id_to_row.items()}

        book = enriched_by_id.get(bid, {})
        year = book.get("publication_year", "?")
        print(f"\n    {titles[idx]} by {authors[idx]} (year={year})")

        for ni in nearest:
            nbid = row_to_id.get(ni, "?")
            nb = enriched_by_id.get(nbid, {})
            sim = dists[ni]
            print(
                f"      -> {nb.get('title', '?')[:50]} "
                f"by {nb.get('author', '?')[:25]} "
                f"(sim={sim:.3f}, year={nb.get('publication_year', '?')})"
            )

    # --- Time-slice check (if years available) ---
    if has_decades:
        print("\n  Time-slice check — books in 1990-2000, sorted by y-position:")
        slice_books = []
        for i, bid in enumerate(book_ids):
            book = enriched_by_id.get(bid, {})
            year = book.get("publication_year")
            if year and 1990 <= year <= 2000:
                slice_books.append((ys[i], titles[i], authors[i]))
        slice_books.sort()
        for y_pos, title, author in slice_books[:15]:
            print(f"      y={y_pos:.3f}  {title[:45]} by {author[:20]}")

    print("\nDone. Inspect data/spotcheck.png visually.")


if __name__ == "__main__":
    main()
