from __future__ import annotations

import json
from pathlib import Path
from typing import List

from fastapi import FastAPI
from pydantic import BaseModel
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


class Query(BaseModel):
    query: str
    k: int = 3


app = FastAPI()

_data_path = Path(__file__).with_name("rag_data.json")
with open(_data_path, "r", encoding="utf-8") as f:
    _properties: List[dict] = json.load(f)

# Build simple TF-IDF index at startup
_corpus = [f"{p['address']} {p['description']}" for p in _properties]
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
