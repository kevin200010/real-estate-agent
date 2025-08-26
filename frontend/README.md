# Property Listing Chatbot Frontend

This directory contains a minimal browser client that displays a floating chat widget for the real-estate listings assistant.

## Usage

1. Start the backend service following the instructions in `../backend/README.md`. By default it runs on `http://localhost:8000`.
2. Serve the static files:
   ```bash
   cd frontend
   python -m http.server 8001
   ```
3. Open [http://localhost:8001/signin.html](http://localhost:8001/signin.html) to create an account or sign in. After logging in you will be redirected to the main app where you can click the blue chat bubble in the bottom-right corner to open the widget and ask about properties.

   Maps are powered by the Google Maps JavaScript API. Copy `config.sample.js` to `config.js` and set `GMAPS_API_KEY` to a valid key. Without an authorized key the map will display a "For development purposes only" watermark.

The client sends requests to the backend's `/chat` endpoint and renders markdown or property cards included in the response. A sample JSON reply expected from the backend:

```json
{
  "reply": "**Here are a few options**",
  "properties": [
    {"image": "https://via.placeholder.com/300x200", "address": "123 Main St", "price": "$500,000", "description": "2 bed / 2 bath condo"}
  ]
}
```
