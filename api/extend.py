"""
POST /api/extend — question-aware retrieval.
Embeds the chosen question, retrieves 20 nearest books via cosine similarity,
asks Claude to rerank down to 3, computes parent_book_id for each result,
and logs the full rerank exchange for eval.
"""

import json
import os
import datetime
from pathlib import Path
from typing import List, Optional

import anthropic
import numpy as np
from fastapi import APIRouter, Request
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
LOG_DIR = Path(__file__).resolve().parent.parent / "eval" / "rerank_logs"

_text_model: Optional[SentenceTransformer] = None


def get_text_model() -> SentenceTransformer:
    global _text_model
    if _text_model is None:
        _text_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _text_model


class ExtendRequest(BaseModel):
    question: str
    question_interpretation: str
    book_ids: List[str]


class AnnotatedBook(BaseModel):
    id: str
    title: str
    author: str
    coverUrl: Optional[str]
    annotation: str
    parent_book_id: str


class ExtendResponse(BaseModel):
    question: str
    further_reading: List[AnnotatedBook]


def compute_parent(
    result_row: int,
    selected_rows: List[int],
    embeddings: np.ndarray,
) -> int:
    result_emb = embeddings[result_row]
    best_row = selected_rows[0]
    best_sim = -2.0
    for row in selected_rows:
        sim = float(np.dot(result_emb, embeddings[row]))
        if sim > best_sim:
            best_sim = sim
            best_row = row
    return best_row


@router.post("/extend", response_model=ExtendResponse)
async def extend_question(req: ExtendRequest, request: Request):
    embeddings: np.ndarray = request.app.state.embeddings
    embedding_index: dict = request.app.state.embedding_index
    books_by_id: dict = request.app.state.books_by_id

    exclude_ids = set(req.book_ids)

    # Build reverse lookup: row_index -> book_id
    row_to_id = {row: bid for bid, row in embedding_index.items()}

    # Selected book rows for parent computation
    selected_rows = [embedding_index[bid] for bid in req.book_ids if bid in embedding_index]

    # Embed question + interpretation together for richer signal
    query_text = f"{req.question} {req.question_interpretation}"
    model = get_text_model()
    question_emb = model.encode([query_text], normalize_embeddings=True)

    text_dim = question_emb.shape[1]
    emb_dim = embeddings.shape[1]
    if text_dim != emb_dim:
        padded = np.zeros((1, emb_dim), dtype=np.float32)
        padded[0, :text_dim] = question_emb[0, :text_dim]
        question_emb = padded

    similarities = np.dot(embeddings, question_emb.T).flatten()
    ranked_indices = np.argsort(similarities)[::-1]

    candidates = []
    for idx in ranked_indices:
        if len(candidates) >= 20:
            break
        bid = row_to_id.get(int(idx))
        if not bid or bid in exclude_ids:
            continue
        book = books_by_id.get(bid, {})
        candidates.append({
            "id": bid,
            "row": int(idx),
            "title": book.get("title", ""),
            "author": book.get("author", ""),
            "description": book.get("description", "no description available"),
            "coverUrl": book.get("coverUrl"),
            "year": book.get("year") or book.get("publishedAt", ""),
        })

    candidate_text = "\n".join(
        f"- ID: {c['id']}, Title: \"{c['title']}\" by {c['author']}. "
        f"Description: {c['description']}"
        for c in candidates
    )

    selected_books_text = "\n".join(
        f"- \"{books_by_id.get(bid, {}).get('title', bid)}\" by {books_by_id.get(bid, {}).get('author', '?')}"
        for bid in req.book_ids
    )

    rerank_prompt = (
        f"The user selected these books from a library:\n{selected_books_text}\n\n"
        f"Together the books raised this question:\n\"{req.question}\"\n\n"
        f"Interpretation: {req.question_interpretation}\n\n"
        f"Here are 20 candidate books retrieved by semantic similarity:\n\n"
        f"{candidate_text}\n\n"
        f"Pick exactly 3 books from this list that best EXTEND the question — "
        f"not just topically adjacent, but ones that rotate, deepen, or complicate "
        f"the question in a way the original selection does not. "
        f"Return three IDs and a 1–2 sentence annotation per book "
        f"showing how it extends the question. Cite by ID.\n\n"
        f"Return strict JSON, no preamble:\n"
        f'{{"further_reading": [{{"id": "...", "annotation": "..."}},'
        f'{{"id": "...", "annotation": "..."}},'
        f'{{"id": "...", "annotation": "..."}}]}}'
    )

    client = anthropic.AsyncAnthropic()
    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1200,
        messages=[{"role": "user", "content": rerank_prompt}],
    )

    response_text = message.content[0].text.strip()
    if response_text.startswith("```"):
        response_text = response_text.split("\n", 1)[1]
        if response_text.endswith("```"):
            response_text = response_text[:-3]

    parsed = json.loads(response_text)

    candidate_map = {c["id"]: c for c in candidates}
    further_reading: List[AnnotatedBook] = []

    for item in parsed.get("further_reading", [])[:3]:
        cand = candidate_map.get(item["id"])
        if not cand:
            continue
        parent_row = compute_parent(cand["row"], selected_rows, embeddings)
        parent_id = row_to_id.get(parent_row, req.book_ids[0])
        further_reading.append(AnnotatedBook(
            id=cand["id"],
            title=cand["title"],
            author=cand["author"],
            coverUrl=cand.get("coverUrl"),
            annotation=item["annotation"],
            parent_book_id=parent_id,
        ))

    # Eval logging
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        log_entry = {
            "timestamp": ts,
            "question": req.question,
            "question_interpretation": req.question_interpretation,
            "selected_book_ids": req.book_ids,
            "candidate_ids": [c["id"] for c in candidates],
            "rerank_prompt": rerank_prompt,
            "rerank_response": response_text,
            "chosen_ids": [fr.id for fr in further_reading],
            "parent_map": {fr.id: fr.parent_book_id for fr in further_reading},
        }
        log_path = LOG_DIR / f"{ts}.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(log_entry, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

    return ExtendResponse(question=req.question, further_reading=further_reading)
