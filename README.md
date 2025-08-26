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

### Google Calendar integration

The appointment booking feature can write events directly to a Google
Calendar. Create a service account with access to the desired calendar and set
the following variables in your `.env` file:

```
GOOGLE_CREDENTIALS_FILE=/path/to/service_account.json
GOOGLE_CALENDAR_ID=your_calendar_id
```

If these values are omitted the backend falls back to an in-memory store, so
appointments will not persist across restarts.

### Syncing each user's personal Google Calendar

The application can link a signed‑in Cognito user to their own Google Calendar
and remember the OAuth credentials for future sessions. To enable this flow:

1. **Create a Google Cloud project** and enable the Google Calendar API.
   Generate an OAuth 2.0 **Web** client ID and note its value.
2. **Configure the frontend.** Copy `frontend/config.sample.js` to
   `frontend/config.js` and set `GOOGLE_CLIENT_ID` to the client ID from the
   previous step.
3. **Set up Cognito authentication.** Create a User Pool and App Client then
   provide their values to the backend via environment variables:

   ```
   COGNITO_REGION=your-region
   COGNITO_USER_POOL_ID=your-user-pool-id
   COGNITO_APP_CLIENT_ID=your-app-client-id
   ```

   Place these in the project’s `.env` file so both the backend and frontend
   can read them.
4. **Run the backend**: `uvicorn backend.web_app:app --reload`.
5. **Serve the frontend** (e.g., `npx serve frontend`), visit the site, sign
   up, and log in with your Cognito credentials.
6. On the leads page click **Sync Google Calendar**. A Google consent screen
   appears; select the account and grant access.
7. The access token is stored server‑side and reused automatically. On your
   next login the application will fetch events from Google Calendar without
   prompting you again.

## Notes

This example focuses on illustrating how components fit together. Production applications should implement robust error handling, streaming audio for low latency, and secure storage of user data.

