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

The app uses [Google Maps](https://developers.google.com/maps) when a `GOOGLE_MAPS_API_KEY` is set in `config.js`. If the key is missing or invalid it falls back to [OpenStreetMap](https://www.openstreetmap.org/) via Leaflet. Property cards display a Google Street View snapshot for each listing when an address or coordinates are available. To enable Google Maps and Street View, copy `config.sample.js` to `config.js` and replace `YOUR_API_KEY_HERE` with a valid API key.

The leads page can sync with each signed-in user's Google Calendar. To enable
this, create a Google Cloud project, enable the Calendar API, and obtain an
OAuth 2.0 **Web** client ID. Copy `config.sample.js` to `config.js` and set
`GOOGLE_CLIENT_ID` to that value. When a user clicks **Sync Google Calendar**
they will be prompted to grant access, and their access token will be stored so
subsequent visits load events automatically. The calendar shows one month at a
time and highlights the current day while listing its appointments by default.
Use the left and right arrow buttons (or keyboard arrows) to change months.

The client sends requests to the backend's `/chat` endpoint and renders markdown or property cards included in the response. A sample JSON reply expected from the backend:

```json
{
  "reply": "**Here are a few options**",
  "properties": [
    {"image": "https://via.placeholder.com/300x200", "address": "123 Main St", "price": "$500,000", "description": "2 bed / 2 bath condo"}
  ]
}
```
