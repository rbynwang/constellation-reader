FROM python:3.11-slim

WORKDIR /app

# Install CPU-only PyTorch first (much smaller than full CUDA build)
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY api/ api/
COPY data/ibi_books_enriched.json data/ibi_books_enriched.json
COPY data/embeddings.npy data/embeddings.npy
COPY data/embedding_index.json data/embedding_index.json
COPY data/coordinates.json data/coordinates.json

EXPOSE 8000

CMD ["sh", "-c", "echo Starting on PORT=$PORT && python -c 'from api.main import app; print(\"Import OK\")' && exec uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8000} --log-level info"]
