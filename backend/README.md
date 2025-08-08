# Property Listing Chatbot Backend

This directory contains a small FastAPI service that answers real-estate
questions. The service uses [LangGraph](https://github.com/langchain-ai/langgraph)
to orchestrate a workflow that searches local property data and calls the
Amazon Nova model through Bedrock to craft a response.

## Setup

```bash
python -m pip install -r requirements.txt
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=us-east-1
```

The application loads sample listings from `rag_data.json` bundled in this
directory. Customize the file or connect a retrieval service for your own data.

## REST API

Start the server:

```bash
uvicorn langgraph_app:app --reload
```

Send a request:

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "3 bedroom house in Seattle"}'
```

The response contains a text reply and any matching property cards.

