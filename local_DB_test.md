# Local PostgreSQL Setup and Testing Guide

Follow these steps to run the Real Estate Agent backend against a local PostgreSQL
instance so you can verify that leads and email credentials stay isolated per
user account.

## 1. Install PostgreSQL

Choose the instructions that match your operating system:

- **macOS (Homebrew)**
  ```bash
  brew update
  brew install postgresql
  brew services start postgresql
  ```
- **Ubuntu / Debian**
  ```bash
  sudo apt-get update
  sudo apt-get install postgresql postgresql-contrib
  sudo service postgresql start
  ```

Once the service is running, confirm that you can connect as the default user:
```bash
psql postgres
```
Type `\q` to exit.

## 2. Create a dedicated database user (optional but recommended)

```bash
createuser --interactive
# Suggested answers:
# Enter name of role to add: realestate
# Shall the new role be a superuser? (y/n) n
# Shall the new role be allowed to create databases? (y/n) n
# Shall the new role be allowed to create more new roles? (y/n) n
```

Set a password for the new role:
```bash
psql postgres -c "ALTER ROLE realestate WITH LOGIN PASSWORD 'change-me';"
```

## 3. Create the application databases

Create separate databases for leads and Gmail credentials (you can reuse one if
preferred):
```bash
createdb real_estate_app
createdb real_estate_gmail
```

Grant ownership to the dedicated user if you created one:
```bash
psql postgres -c "ALTER DATABASE real_estate_app OWNER TO realestate;"
psql postgres -c "ALTER DATABASE real_estate_gmail OWNER TO realestate;"
```

## 4. Configure environment variables

From the repository root, export the connection URLs before starting the app or
running tests:
```bash
export DATABASE_URL=postgresql://realestate:change-me@localhost:5432/real_estate_app
export GMAIL_DATABASE_URL=postgresql://realestate:change-me@localhost:5432/real_estate_gmail
```

For Windows PowerShell, use:
```powershell
$env:DATABASE_URL = "postgresql://realestate:change-me@localhost:5432/real_estate_app"
$env:GMAIL_DATABASE_URL = "postgresql://realestate:change-me@localhost:5432/real_estate_gmail"
```

> **Tip:** If you prefer to keep both schemas in a single database, set both
> variables to the same URL.

## 5. Install backend dependencies

```bash
python -m pip install -r backend/requirements.txt
```

## 6. Initialize tables

The FastAPI application lazily creates tables on first import. You can trigger
that without launching the server by running the backend test suite once:
```bash
pytest backend
```
Alternatively, start the API directly:
```bash
uvicorn backend.web_app:app --reload
```

Both commands will connect to PostgreSQL using the URLs you exported and create
any missing tables (e.g., `leads`, `gmail_accounts`, and `linked_email_accounts`).

## 7. Run the full tests against PostgreSQL

With the environment variables still set, execute the project tests to verify
user-specific isolation of leads and email records:
```bash
pytest
```

All lead and email access tests should pass, confirming that each signed-in user
only sees their own data.

## 8. Inspect the database (optional)

Use `psql` to connect and inspect the tables:
```bash
psql real_estate_app
\dt
SELECT * FROM leads LIMIT 5;
```

If you need to reset your environment, drop and recreate the databases:
```bash
dropdb real_estate_app
createdb real_estate_app
```

Repeat for `real_estate_gmail` if necessary.
