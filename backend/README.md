# Property Listing Chatbot Backend

This directory hosts the FastAPI service and supporting modules for the property listing assistant.

## Setup

1. Install dependencies and configure AWS credentials for Bedrock:
   ```bash
   python -m pip install -r requirements.txt
   export AWS_ACCESS_KEY_ID=...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_DEFAULT_REGION=us-east-1
   ```
2. (Optional) Start the demo RAG server populated with 100 commercial listings:
   ```bash
   uvicorn rag_server:app --reload --port 8001
   ```
   Then point the chatbot at it:
   ```bash
   export RAG_SERVER_URL=http://localhost:8001/query
   ```
   The server indexes `rag_data.json`, which contains 100 richly described properties for demo queries.

## Command line

Run the orchestrator directly:
```bash
python property_chatbot.py --text "3 bedroom house in Seattle"
python property_chatbot.py --audio question.wav
```
The audio command prints the transcript and answer and writes `response_audio.pcm`.

## REST API

Start the FastAPI server:
```bash
uvicorn web_app:app --reload
```

Send sample requests:
```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"text": "3 bedroom house in Seattle"}'

curl -X POST http://localhost:8000/voice -F "file=@question.wav"
```
The `/voice` endpoint returns a transcript, text answer, and base64 encoded audio response.
