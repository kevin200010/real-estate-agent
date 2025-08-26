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

The app uses [Google Maps](https://developers.google.com/maps) when a `GOOGLE_MAPS_API_KEY` is set in `config.js`. If the key is missing or invalid it falls back to [OpenStreetMap](https://www.openstreetmap.org/) via Leaflet. To enable Google Maps, copy `config.sample.js` to `config.js` and replace `YOUR_API_KEY_HERE` with a valid API key.

The leads page can optionally display events from a Google Calendar. Set `GOOGLE_CALENDAR_API_KEY` and `GOOGLE_CALENDAR_ID` in `config.js` to load appointments from that calendar. The calendar shows three upcoming months in a scrollable view and highlights the current day while listing its appointments by default.

The client sends requests to the backend's `/chat` endpoint and renders markdown or property cards included in the response. A sample JSON reply expected from the backend:

```json
{
  "reply": "**Here are a few options**",
  "properties": [
    {"image": "https://via.placeholder.com/300x200", "address": "123 Main St", "price": "$500,000", "description": "2 bed / 2 bath condo"}
  ]
}
```
