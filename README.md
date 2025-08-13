# Cascade AI

This sample demonstrates how to combine Amazon Nova core models with Nova Sonic to build a multimodal real-estate assistant. The Cascade AI application answers typed or spoken questions about sample property listings.


## Architecture

1. **Central Orchestrator** – `PropertyChatbot` routes text or audio input and coordinates other components.
2. **Retrieval Layer** – `RAGRetriever` queries an external retrieval-augmented generation service for matching listings (falls back to a local JSON file if the service is unavailable). A demo FastAPI RAG server with 100 synthetic commercial listings lives in `backend/rag_server.py`.
3. **Core Nova Model** – `LLMClient` calls a text-based Nova model to reason over retrieved listings and craft answers.
4. **Nova Sonic** – `SonicClient` converts speech to text and text to speech so the assistant can handle voice interactions.

## Environment configuration

The backend expects AWS credentials to be provided via environment variables so
it can call Amazon Bedrock. For local development you can place these variables
in a `.env` file at the project root:

```
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_SESSION_TOKEN=...  # optional
AWS_DEFAULT_REGION=us-east-1
```

The application automatically loads this file on startup, allowing boto3 to pick
up the credentials without exporting them manually.

## Notes

This example focuses on illustrating how components fit together. Production applications should implement robust error handling, streaming audio for low latency, and secure storage of user data.


## Demo portals

Two simple HTML portals demonstrate how customers and admins can interact with the backend:

- `frontend/customer.html` allows a customer to log in, browse properties, and book appointments.
- `frontend/admin.html` lets an admin manage availability and view all booked appointments.
