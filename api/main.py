"""
FastAPI application — serves question generation and further-reading endpoints.
"""

import json
import os
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from api.questions import router as questions_router
from api.extend import router as extend_router

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

app = FastAPI(title="Constellation Reader API")

CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:3000",
]
if os.getenv("FRONTEND_URL"):
    CORS_ORIGINS.append(os.getenv("FRONTEND_URL"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

books_data: List[dict] = []
books_by_id: Dict[str, dict] = {}
embeddings: Optional[np.ndarray] = None
embedding_index: List[dict] = []


@app.on_event("startup")
async def load_data():
    global books_data, books_by_id, embeddings, embedding_index

    enriched_path = DATA_DIR / "ibi_books_enriched.json"
    if enriched_path.exists():
        with open(enriched_path, "r", encoding="utf-8") as f:
            books_data = json.load(f)
        books_by_id = {b.get("_id", b.get("id", str(i))): b for i, b in enumerate(books_data)}

    emb_path = DATA_DIR / "embeddings.npy"
    if emb_path.exists():
        embeddings = np.load(emb_path)

    idx_path = DATA_DIR / "embedding_index.json"
    if idx_path.exists():
        with open(idx_path, "r", encoding="utf-8") as f:
            embedding_index = json.load(f)

    coords_path = DATA_DIR / "coordinates.json"
    coords = []
    if coords_path.exists():
        with open(coords_path, "r", encoding="utf-8") as f:
            coords = json.load(f)

    app.state.books_data = books_data
    app.state.books_by_id = books_by_id
    app.state.embeddings = embeddings
    app.state.embedding_index = embedding_index
    app.state.coordinates = coords

    print(f"Loaded {len(books_data)} books, embeddings shape: {embeddings.shape if embeddings is not None else 'N/A'}")


@app.get("/api/books")
async def get_books():
    return app.state.coordinates


@app.get("/api/books/{book_id}")
async def get_book(book_id: str):
    book = app.state.books_by_id.get(book_id)
    if not book:
        return {"error": "Book not found"}
    return book


app.include_router(questions_router, prefix="/api")
app.include_router(extend_router, prefix="/api")
