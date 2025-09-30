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

### Database setup

The backend persists both CRM leads and Gmail credentials in a relational
database. By default it creates a local SQLite file at `./leads.db`, but you can
point it at PostgreSQL or any other database supported by the standard library
`sqlite3` module.

1. **Choose a location**

   ```bash
   # SQLite (default)
   export DATABASE_URL=sqlite:///./data/app.db

   # Optional: store Gmail credentials in a separate database
   export GMAIL_DATABASE_URL=$DATABASE_URL

   # PostgreSQL example
   export DATABASE_URL=postgresql://user:password@localhost:5432/real_estate
   export GMAIL_DATABASE_URL=$DATABASE_URL
   ```

2. **Create the database (PostgreSQL only)**

   ```bash
   createdb real_estate
   ```

3. **Start the FastAPI app** – the first import of `backend.leads` and
   `backend.gmail_accounts` automatically creates the required tables:

   - `leads` stores every lead keyed by `user_id` and the email address that
     created it, ensuring one user's leads never appear in another user's list.
   - `gmail_accounts` and `linked_email_accounts` persist per-user Gmail IMAP
     credentials, access tokens, and the linked email address so only the
     authenticated owner can sync or send mail.

   ```bash
   uvicorn backend.web_app:app --reload
   ```

When `AUTH_ENABLED` is `True` (for example when Amazon Cognito is configured)
each request is scoped to the caller's user ID, so leads and email credentials
remain isolated for that account.

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

