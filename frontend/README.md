# Property Listing Chatbot Frontend

This directory contains a minimal browser client that interacts with the backend service.

## Usage

1. Start the backend service following the instructions in `../backend/README.md`. By default it runs on `http://localhost:8000`.
2. Serve the static files:
   ```bash
   cd frontend
   python -m http.server 8001
   ```
3. Open [http://localhost:8001](http://localhost:8001) in a browser. Enter a question or use the microphone button to speak.

The page sends requests to the backend's `/chat` and `/voice` endpoints and plays any audio response returned.
