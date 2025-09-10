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

### Optional: Google Calendar integration

The appointment-booking UI can read and write events on a Google Calendar. To
enable this feature you need a service account with access to the calendar you
want to use:

1. Create a project in the [Google Cloud console](https://console.cloud.google.com/)
   and enable the **Google Calendar API** for it.
2. Under *APIs & Services → Credentials* create a **service account** and
   download its JSON key file.
3. In Google Calendar, share the desired calendar with the service account's
   email address and give it permission to "Make changes to events".
4. Set the following environment variables so the backend can authenticate:

   ```bash
   export GOOGLE_CREDENTIALS_FILE=/path/to/service_account.json
   export GOOGLE_CALENDAR_ID=your_calendar_id
   ```

If these variables are omitted the server falls back to an in-memory store and
appointments will not persist across restarts.

### Optional: Email integration

The backend exposes endpoints for viewing and sending emails from Gmail or
Outlook.

- **Sync credentials** – POST `/emails/{provider}/sync` with `username` and
  `password`. The server stores credentials in memory for the session and uses
  them for later requests.
- **List emails** – GET `/emails/{provider}` to retrieve recent messages.
- **Send email** – POST `/emails/{provider}/send` with `to`, `subject`, and
  `body` (credentials may be omitted if previously synced).

If credentials are missing or incorrect the listing endpoint returns an empty
list instead of raising an error.

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

