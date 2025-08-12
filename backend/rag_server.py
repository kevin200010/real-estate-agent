from __future__ import annotations

from pathlib import Path
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Reuse the CSV loading logic from ``PropertyRetriever`` so the RAG server
# can index the same dataset used by the rest of the application.  This avoids
# duplicating the somewhat messy CSV parsing code and keeps the data source in
# one place.
from .property_chatbot import PropertyRetriever


class Query(BaseModel):
    query: str
    k: int = 3


app = FastAPI()

# Load listings from the CSV dataset shipped with the project.  ``PropertyRetriever``
# normalizes the raw data into dictionaries with ``address`` and ``description``
# fields which we then index for semantic similarity search.
_data_path = (
    Path(__file__).resolve().parents[1] / "frontend" / "data" / "listings.csv"
)
_retriever = PropertyRetriever(_data_path)
_properties: List[dict] = _retriever.properties

# Build simple TF-IDF index at startup
_corpus = [
    f"{p.get('address', '')} {p.get('description', '')} {p.get('type', '')}"
    for p in _properties
]
_vectorizer = TfidfVectorizer().fit(_corpus)
_doc_matrix = _vectorizer.transform(_corpus)


@app.post("/query")
def query_listings(q: Query):
    """Return top-k property listings matching the query."""
    vec = _vectorizer.transform([q.query])
    sims = cosine_similarity(vec, _doc_matrix)[0]
    top = sims.argsort()[::-1][: q.k]
    results = [_properties[i] for i in top]
    return {"results": results}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
