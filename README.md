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

### Local PostgreSQL database

By default, leads are stored in a SQLite file. To persist them in PostgreSQL
instead:

1. Install PostgreSQL and the Python driver: `pip install psycopg2-binary`.
2. Create a database, for example:

   ```bash
   psql -U postgres -c "CREATE DATABASE cascade_ai;"
   ```

3. Set the connection string in your `.env` file so the backend connects to it:

   ```
   DATABASE_URL=postgresql://username:password@localhost:5432/cascade_ai
   ```

   Replace the credentials with those for your local setup.

The `leads` table is created automatically on first run.

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

### Email integration (Gmail)

The application can link to Gmail through OAuth and display messages from the
selected account.

1. **Open the Emails page** – Start the backend and frontend servers, sign in,
   then navigate to the **Emails** tab in the top bar.
2. **Connect Gmail** – Click the **Connect Gmail** button and choose an account
   from the Google account picker. Grant the requested permissions.
3. **View messages** – After authorization the page loads recent messages from
   the chosen Gmail account.
4. **Send email** – Use the floating **Compose** button in the bottom‑right to
   draft a message. The form sends the email through Gmail's API using the
   authorized account.

#### Database setup for Gmail sync

Linked Gmail accounts and credentials are stored server‑side so each Cognito
user only sees messages from the Gmail address they connected. The backend
persists these details in two tables, `gmail_accounts` and
`linked_email_accounts`.

* **SQLite (default)** – If you are using the default SQLite database
  (`sqlite:///./leads.db`), no additional setup is required. The tables are
  created automatically the first time the backend starts.
* **PostgreSQL** – To store Gmail credentials in PostgreSQL instead, provision a
  database (see the _Local PostgreSQL database_ section above for commands) and
  point the backend at it:

  ```bash
  # Optional: use a separate database just for Gmail data
  export GMAIL_DATABASE_URL=postgresql://username:password@localhost:5432/cascade_ai_gmail
  ```

  If `GMAIL_DATABASE_URL` is not set the Gmail tables reuse the primary
  `DATABASE_URL`. After setting the desired connection string, start the backend
  once and it will create the `gmail_accounts` and `linked_email_accounts`
  tables automatically.

### Property listings database

Property inventory is now stored in a dedicated database so listing removals and
restores survive browser refreshes and multi-user sessions.

* **Default (SQLite)** – When `PROPERTIES_DB_URL` is not set the backend writes
  to `backend/data/properties.db`. The schema is created automatically on first
  import and seeded with the sample `frontend/data/listings.csv` file when the
  table is empty.
* **Custom seed data** – Point the `PROPERTIES_SEED_CSV` environment variable to
  one or more CSV files (use the system path separator to list multiple files)
  before starting the API. The loader will populate the database from those
  files the first time it runs.

#### Local testing

1. Install backend dependencies: `python -m pip install -r backend/requirements.txt`.
2. (Optional) Switch to PostgreSQL by exporting
   `PROPERTIES_DB_URL=postgresql://user:password@localhost:5432/properties`.
3. Start the API (`uvicorn backend.web_app:app --reload`) and load the sourcing
   page. The FastAPI router exposes:
   * `GET /properties` – list all listings.
   * `POST /properties` – add a new listing.
   * `POST /properties/{id}/remove` – mark a listing as out of system.
   * `POST /properties/{id}/restore` – bring the record back into circulation.
4. Inspect the local SQLite database with `sqlite3 backend/data/properties.db`
   or, for PostgreSQL, with `psql`.

#### AWS deployment

1. Provision an Amazon RDS PostgreSQL instance (db.t3.micro is sufficient for
   testing) and create a database, e.g. `real_estate_properties`.
2. Configure the application server with
   `PROPERTIES_DB_URL=postgresql+psycopg2://username:password@hostname:5432/real_estate_properties`.
3. Optionally upload a CSV of seed listings and set
   `PROPERTIES_SEED_CSV=/path/to/seed.csv` so the instance starts populated.
4. Install dependencies on the host (`python -m pip install -r backend/requirements.txt`).
5. Launch the FastAPI app (systemd, `uvicorn`, or your container orchestrator).
   The property tables are created automatically; no manual migrations are
   required.

## Notes

This example focuses on illustrating how components fit together. Production applications should implement robust error handling, streaming audio for low latency, and secure storage of user data.

