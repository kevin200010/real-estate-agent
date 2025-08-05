# Property Listing Chatbot

This sample demonstrates how to combine Amazon Nova core models with Nova Sonic to build a multimodal real-estate assistant. The chatbot answers typed or spoken questions about sample property listings.

The project is split into two parts:

- **backend/** – FastAPI service and command-line tools. See `backend/README.md` for setup and API instructions.
- **frontend/** – Static browser client. See `frontend/README.md` for usage.

## Architecture

1. **Central Orchestrator** – `PropertyChatbot` routes text or audio input and coordinates other components.
2. **Retrieval Layer** – `PropertyRetriever` loads a JSON file of sample listings and performs naive keyword search.
3. **Core Nova Model** – `LLMClient` calls a text-based Nova model to reason over retrieved listings and craft answers.
4. **Nova Sonic** – `SonicClient` converts speech to text and text to speech so the assistant can handle voice interactions.

## Notes

This example focuses on illustrating how components fit together. Production applications should implement robust error handling, streaming audio for low latency, and secure storage of user data.
