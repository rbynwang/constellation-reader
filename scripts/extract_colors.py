"""Extract dominant colors from book covers using vibrancy-weighted k-means."""
from __future__ import annotations

import colorsys
import io
import json
import os
import sys
import time
from pathlib import Path
from urllib.request import urlopen, Request

import numpy as np
from PIL import Image
from sklearn.cluster import MiniBatchKMeans

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ENRICHED = DATA_DIR / "ibi_books_enriched.json"
COVER_CACHE = DATA_DIR / "covers"
N_CLUSTERS = 6
THUMB_SIZE = 150
SAVE_EVERY = 50


def rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


def vibrancy_score(r: int, g: int, b: int) -> float:
    """Score a color by saturation and brightness — vivid colors win."""
    h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
    # Penalize very dark or very light colors
    brightness_penalty = 1.0
    if v < 0.15:
        brightness_penalty = 0.2
    elif v < 0.3:
        brightness_penalty = 0.5
    elif v > 0.95 and s < 0.1:
        brightness_penalty = 0.3  # near-white
    return s * v * brightness_penalty


def extract_palette(img: Image.Image, n: int = N_CLUSTERS) -> list[tuple[int, int, int]]:
    """Extract n colors using k-means, return sorted by vibrancy."""
    img = img.convert("RGB").resize(
        (THUMB_SIZE, THUMB_SIZE), Image.LANCZOS
    )
    pixels = np.array(img).reshape(-1, 3).astype(np.float64)

    kmeans = MiniBatchKMeans(n_clusters=n, random_state=42, n_init=3)
    kmeans.fit(pixels)
    centers = kmeans.cluster_centers_.astype(int)

    scored = []
    for c in centers:
        r, g, b = int(c[0]), int(c[1]), int(c[2])
        scored.append((vibrancy_score(r, g, b), (r, g, b)))

    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored]


def download_cover(url: str, cache_path: Path) -> Image.Image | None:
    """Download cover image, caching to disk."""
    if cache_path.exists():
        try:
            return Image.open(cache_path)
        except Exception:
            cache_path.unlink(missing_ok=True)

    try:
        # Use small size for color extraction
        fetch_url = url + "?w=200&fit=crop&auto=format&q=70"
        req = Request(fetch_url, headers={"User-Agent": "IBI-ColorExtractor/1.0"})
        with urlopen(req, timeout=15) as resp:
            data = resp.read()
        img = Image.open(io.BytesIO(data))
        img.save(cache_path, "JPEG", quality=85)
        return img
    except Exception as e:
        print(f"  download failed: {e}")
        return None


def main():
    with open(ENRICHED) as f:
        books = json.load(f)

    COVER_CACHE.mkdir(parents=True, exist_ok=True)

    # Find books that need processing
    todo = []
    for b in books:
        if not b.get("coverUrl"):
            continue
        if b.get("dominant_color"):
            continue
        todo.append(b)

    print(f"Books with covers: {sum(1 for b in books if b.get('coverUrl'))}")
    print(f"Already processed: {sum(1 for b in books if b.get('dominant_color'))}")
    print(f"To process: {len(todo)}")

    if not todo:
        print("Nothing to do.")
        return

    processed = 0
    failed = 0
    t0 = time.time()

    for i, book in enumerate(todo):
        book_id = book["_id"]
        cache_path = COVER_CACHE / f"{book_id}.jpg"

        img = download_cover(book["coverUrl"], cache_path)
        if img is None:
            failed += 1
            book["dominant_color"] = None
            book["cover_palette"] = None
            continue

        try:
            palette = extract_palette(img)
            dominant = palette[0]
            book["dominant_color"] = rgb_to_hex(*dominant)
            book["cover_palette"] = [rgb_to_hex(*c) for c in palette[:3]]
            processed += 1
        except Exception as e:
            print(f"  extract failed for {book_id}: {e}")
            book["dominant_color"] = None
            book["cover_palette"] = None
            failed += 1

        if (i + 1) % 20 == 0:
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed
            remaining = (len(todo) - i - 1) / rate
            print(
                f"  [{i+1}/{len(todo)}] "
                f"{processed} ok, {failed} failed, "
                f"{rate:.1f}/s, ~{remaining/60:.0f}min left"
            )

        if (i + 1) % SAVE_EVERY == 0:
            with open(ENRICHED, "w") as f:
                json.dump(books, f, indent=2)
            print(f"  saved progress at {i+1}")

    # Final save
    with open(ENRICHED, "w") as f:
        json.dump(books, f, indent=2)

    elapsed = time.time() - t0
    print(f"\nDone: {processed} processed, {failed} failed in {elapsed:.0f}s")

    # Quick vibrancy spot-check
    colors_extracted = [b for b in books if b.get("dominant_color")]
    if colors_extracted:
        sample = colors_extracted[:50]
        saturations = []
        for b in sample:
            hex_c = b["dominant_color"]
            r, g, b_val = int(hex_c[1:3], 16), int(hex_c[3:5], 16), int(hex_c[5:7], 16)
            _, s, v = colorsys.rgb_to_hsv(r/255, g/255, b_val/255)
            saturations.append(s)
        avg_sat = sum(saturations) / len(saturations)
        print(f"Spot-check: avg saturation of first 50 = {avg_sat:.2f}")
        if avg_sat < 0.15:
            print("WARNING: colors look desaturated, extraction may need tuning")
        else:
            print("Vibrancy looks good.")


if __name__ == "__main__":
    main()
