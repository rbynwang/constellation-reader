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

COPY start.py .

CMD ["python", "start.py"]
