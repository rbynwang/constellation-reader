"""
Stage 2 — Embeddings
Text embeddings via OpenAI text-embedding-3-large (fallback: sentence-transformers).
Image embeddings via CLIP ViT-B-32 (open_clip).
Combined vector: 0.7 text + 0.3 image (configurable).
Output: data/embeddings.npy + data/embedding_index.json
"""

from __future__ import annotations

import json
import os
import asyncio
import sys
from pathlib import Path

import httpx
import numpy as np
import torch
import open_clip
from PIL import Image
from io import BytesIO

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
INPUT_FILE = DATA_DIR / "ibi_books_enriched.json"
EMBEDDINGS_FILE = DATA_DIR / "embeddings.npy"
INDEX_FILE = DATA_DIR / "embedding_index.json"
COVERS_DIR = DATA_DIR / "covers"
TEXT_CACHE_FILE = DATA_DIR / "text_embeddings_cache.npy"
TEXT_CACHE_IDS_FILE = DATA_DIR / "text_embeddings_ids.json"
IMAGE_CACHE_FILE = DATA_DIR / "image_embeddings_cache.npy"
IMAGE_CACHE_IDS_FILE = DATA_DIR / "image_embeddings_ids.json"

TEXT_WEIGHT = float(os.getenv("TEXT_WEIGHT", "0.7"))
IMAGE_WEIGHT = float(os.getenv("IMAGE_WEIGHT", "0.3"))
USE_OPENAI = os.getenv("USE_OPENAI", "1") == "1"


def load_books() -> list[dict]:
    with open(INPUT_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def get_working_set(books: list[dict]) -> list[dict]:
    return [b for b in books if b.get("coverUrl")]


def get_book_id(book: dict) -> str:
    return book.get("_id", book.get("id", ""))


def build_text_input(book: dict) -> str:
    title = book.get("title", "")
    author = book.get("author", "")
    desc = book.get("description", "")
    text = title
    if author:
        text += f" by {author}"
    if desc:
        text += f". {desc}"
    return text


# --- Text embeddings ---


def compute_text_openai(texts: list[str], batch_size: int = 100) -> np.ndarray:
    from openai import OpenAI

    client = OpenAI()
    all_embeddings = []
    print(f"  Encoding {len(texts)} texts via OpenAI text-embedding-3-large...")

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        truncated = [t[:8000] for t in batch]
        resp = client.embeddings.create(model="text-embedding-3-large", input=truncated)
        batch_emb = [item.embedding for item in resp.data]
        all_embeddings.extend(batch_emb)
        print(f"    {min(i + batch_size, len(texts))}/{len(texts)} texts encoded")

    return np.array(all_embeddings, dtype=np.float32)


def compute_text_sbert(texts: list[str]) -> np.ndarray:
    from sentence_transformers import SentenceTransformer

    print("  Loading text model (all-MiniLM-L6-v2)...")
    model = SentenceTransformer("all-MiniLM-L6-v2")
    print(f"  Encoding {len(texts)} texts...")
    embeddings = model.encode(
        texts, show_progress_bar=True, normalize_embeddings=True, batch_size=64
    )
    return np.array(embeddings, dtype=np.float32)


def compute_text_embeddings(
    texts: list[str], book_ids: list[str]
) -> np.ndarray:
    cached_emb, cached_ids = load_cache(TEXT_CACHE_FILE, TEXT_CACHE_IDS_FILE)
    if cached_emb is not None and list(cached_ids) == book_ids:
        print(f"  Text embeddings loaded from cache ({cached_emb.shape})")
        return cached_emb

    if USE_OPENAI and os.getenv("OPENAI_API_KEY"):
        try:
            emb = compute_text_openai(texts)
        except Exception as e:
            print(f"  OpenAI failed ({e}), falling back to sentence-transformers")
            emb = compute_text_sbert(texts)
    else:
        if USE_OPENAI:
            print("  OPENAI_API_KEY not set, using sentence-transformers fallback")
        emb = compute_text_sbert(texts)

    norms = np.linalg.norm(emb, axis=1, keepdims=True)
    norms[norms == 0] = 1
    emb = emb / norms

    save_cache(emb, book_ids, TEXT_CACHE_FILE, TEXT_CACHE_IDS_FILE)
    return emb


# --- Image embeddings ---


async def download_cover(
    client: httpx.AsyncClient, url: str, cache_path: Path
) -> Image.Image | None:
    if cache_path.exists():
        try:
            return Image.open(cache_path).convert("RGB")
        except Exception:
            pass
    try:
        resp = await client.get(url, follow_redirects=True)
        resp.raise_for_status()
        data = resp.content
        cache_path.write_bytes(data)
        return Image.open(BytesIO(data)).convert("RGB")
    except Exception:
        return None


async def download_covers(
    books: list[dict], batch_size: int = 30
) -> list[Image.Image | None]:
    COVERS_DIR.mkdir(parents=True, exist_ok=True)
    images: list[Image.Image | None] = [None] * len(books)
    already_cached = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        for i in range(0, len(books), batch_size):
            batch = books[i : i + batch_size]
            tasks = []
            for b in batch:
                bid = get_book_id(b)
                cache_path = COVERS_DIR / f"{bid}.jpg"
                tasks.append(download_cover(client, b["coverUrl"], cache_path))
            results = await asyncio.gather(*tasks)
            for j, img in enumerate(results):
                images[i + j] = img
            done = sum(1 for img in images if img is not None)
            if (i + batch_size) % 150 == 0 or i + batch_size >= len(books):
                print(f"    {done}/{len(books)} covers ready")
            await asyncio.sleep(0.05)

    already_cached = sum(
        1
        for b in books
        if (COVERS_DIR / f"{get_book_id(b)}.jpg").exists()
    )
    downloaded = sum(1 for img in images if img is not None)
    print(f"  {downloaded} covers available ({already_cached} from cache)")
    return images


def compute_image_embeddings(
    images: list[Image.Image | None], book_ids: list[str]
) -> np.ndarray:
    cached_emb, cached_ids = load_cache(IMAGE_CACHE_FILE, IMAGE_CACHE_IDS_FILE)
    if cached_emb is not None and list(cached_ids) == book_ids:
        print(f"  Image embeddings loaded from cache ({cached_emb.shape})")
        return cached_emb

    print("  Loading CLIP model (ViT-B-32)...")
    model, _, preprocess = open_clip.create_model_and_transforms(
        "ViT-B-32", pretrained="laion2b_s34b_b79k"
    )
    model.eval()

    dim = 512
    embeddings = np.zeros((len(images), dim), dtype=np.float32)
    errors = 0

    print(f"  Encoding {len(images)} images...")
    with torch.no_grad():
        for i, img in enumerate(images):
            if img is None:
                continue
            try:
                tensor = preprocess(img).unsqueeze(0)
                feat = model.encode_image(tensor)
                feat = feat / feat.norm(dim=-1, keepdim=True)
                embeddings[i] = feat.cpu().numpy().flatten()
            except Exception as e:
                errors += 1
                if errors <= 5:
                    print(f"    Error on image {i}: {e}")
            if (i + 1) % 200 == 0:
                print(f"    {i + 1}/{len(images)} images encoded")

    print(f"  {len(images) - errors} images encoded, {errors} errors")
    save_cache(embeddings, book_ids, IMAGE_CACHE_FILE, IMAGE_CACHE_IDS_FILE)
    return embeddings


# --- Caching helpers ---


def load_cache(
    npy_path: Path, ids_path: Path
) -> tuple[np.ndarray | None, list[str] | None]:
    if npy_path.exists() and ids_path.exists():
        try:
            emb = np.load(npy_path)
            with open(ids_path, "r") as f:
                ids = json.load(f)
            return emb, ids
        except Exception:
            pass
    return None, None


def save_cache(emb: np.ndarray, ids: list[str], npy_path: Path, ids_path: Path):
    np.save(npy_path, emb)
    with open(ids_path, "w") as f:
        json.dump(ids, f)


# --- Combine ---


def combine_embeddings(
    text_emb: np.ndarray, image_emb: np.ndarray
) -> np.ndarray:
    text_dim = text_emb.shape[1]
    image_dim = image_emb.shape[1]

    if text_dim != image_dim:
        from sklearn.decomposition import PCA

        target_dim = min(text_dim, image_dim)
        print(f"  Aligning dimensions: text={text_dim}, image={image_dim} -> {target_dim}")
        if text_dim > target_dim:
            pca = PCA(n_components=target_dim)
            text_emb = pca.fit_transform(text_emb)
        if image_dim > target_dim:
            pca = PCA(n_components=target_dim)
            image_emb = pca.fit_transform(image_emb)

    text_norms = np.linalg.norm(text_emb, axis=1, keepdims=True)
    text_norms[text_norms == 0] = 1
    text_emb = text_emb / text_norms

    image_norms = np.linalg.norm(image_emb, axis=1, keepdims=True)
    image_norms[image_norms == 0] = 1
    image_emb = image_emb / image_norms

    has_image = np.any(image_emb != 0, axis=1)
    combined = np.zeros_like(text_emb)
    combined[has_image] = (
        TEXT_WEIGHT * text_emb[has_image] + IMAGE_WEIGHT * image_emb[has_image]
    )
    combined[~has_image] = text_emb[~has_image]

    norms = np.linalg.norm(combined, axis=1, keepdims=True)
    norms[norms == 0] = 1
    combined = combined / norms

    return combined


# --- Main ---


async def main():
    print("Stage 2 — Embeddings")
    print(f"  Text weight: {TEXT_WEIGHT}, Image weight: {IMAGE_WEIGHT}")

    books = load_books()
    working_set = get_working_set(books)
    print(f"  Working set: {len(working_set)} books with cover images")

    book_ids = [get_book_id(b) for b in working_set]
    texts = [build_text_input(b) for b in working_set]

    text_emb = compute_text_embeddings(texts, book_ids)
    print(f"  Text embeddings: {text_emb.shape}")

    print("\n  Downloading cover images...")
    images = await download_covers(working_set)

    image_emb = compute_image_embeddings(images, book_ids)
    print(f"  Image embeddings: {image_emb.shape}")

    print(f"\n  Combining embeddings (text={TEXT_WEIGHT}, image={IMAGE_WEIGHT})...")
    combined = combine_embeddings(text_emb, image_emb)
    print(f"  Combined: {combined.shape}")

    np.save(EMBEDDINGS_FILE, combined)
    print(f"  Saved to {EMBEDDINGS_FILE}")

    index = {}
    for i, book in enumerate(working_set):
        index[get_book_id(book)] = i

    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    print(f"  Saved index ({len(index)} entries) to {INDEX_FILE}")

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
