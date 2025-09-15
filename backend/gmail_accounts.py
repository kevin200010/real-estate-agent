from __future__ import annotations

"""Persistence helpers for linked Gmail accounts."""

import os
import sqlite3
from datetime import datetime, timezone
from typing import Dict, Optional

try:  # pragma: no cover - optional dependency
    import psycopg2  # type: ignore
    import psycopg2.extras  # type: ignore
except Exception:  # pragma: no cover
    psycopg2 = None  # type: ignore


DATABASE_URL = os.getenv("GMAIL_DATABASE_URL") or os.getenv(
    "DATABASE_URL", "sqlite:///./leads.db"
)


def _is_postgres(url: Optional[str] = None) -> bool:
    target = url or DATABASE_URL
    return target.startswith("postgres") and psycopg2 is not None


def _get_conn(url: Optional[str] = None):
    target = url or DATABASE_URL
    if _is_postgres(target):  # pragma: no cover - depends on psycopg2
        return psycopg2.connect(target)
    path = target.replace("sqlite:///", "")
    if path != ":memory:":
        directory = os.path.dirname(path) or "."
        os.makedirs(directory, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _get_cursor(conn, url: Optional[str] = None):
    target = url or DATABASE_URL
    if _is_postgres(target):  # pragma: no cover - depends on psycopg2
        return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    return conn.cursor()


def _ensure_schema(url: Optional[str] = None) -> None:
    target = url or DATABASE_URL
    with _get_conn(target) as conn:
        cur = _get_cursor(conn, target)
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS gmail_accounts (
                provider TEXT NOT NULL,
                user_id TEXT NOT NULL,
                email TEXT,
                access_token TEXT,
                token_type TEXT,
                scope TEXT,
                expires_at TEXT,
                updated_at TEXT,
                imap_username TEXT,
                imap_password TEXT,
                PRIMARY KEY (provider, user_id)
            )
            """
        )

        # Older installations may not yet include the ``imap_username`` and
        # ``imap_password`` columns. Attempt to add them when they are
        # missing so credentials gathered from the sync endpoint can be
        # persisted alongside OAuth tokens.
        try:
            columns: set[str] = set()
            if _is_postgres(target):  # pragma: no cover - depends on psycopg2
                cur.execute(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'gmail_accounts'
                    AND table_schema = current_schema()
                    """
                )
                columns = {row[0] for row in cur.fetchall()}
            else:
                cur.execute("PRAGMA table_info(gmail_accounts)")
                rows = cur.fetchall()
                for row in rows:
                    if isinstance(row, sqlite3.Row):
                        columns.add(str(row["name"]))
                    else:
                        # PRAGMA table_info returns tuples of the form
                        # (cid, name, type, notnull, dflt_value, pk)
                        columns.add(str(row[1]))

            for column in ("imap_username", "imap_password"):
                if column not in columns:
                    cur.execute(f"ALTER TABLE gmail_accounts ADD COLUMN {column} TEXT")
        except Exception:  # pragma: no cover - defensive
            # Failing to add the optional columns should not prevent the
            # application from starting. Loggers are not configured here so
            # we simply swallow the exception.
            pass

        conn.commit()


_ensure_schema()


def configure_database(url: str) -> None:
    """Configure the storage backend and ensure the schema exists."""

    global DATABASE_URL
    DATABASE_URL = url
    _ensure_schema(url)


def save_account(
    provider: str,
    user_id: str,
    *,
    email: Optional[str] = None,
    access_token: Optional[str] = None,
    token_type: Optional[str] = None,
    scope: Optional[str] = None,
    expires_at: Optional[str] = None,
    imap_username: Optional[str] = None,
    imap_password: Optional[str] = None,
) -> Dict[str, Optional[str]]:
    """Insert or update a linked Gmail account for a user."""

    if not provider or not user_id:
        raise ValueError("provider and user_id are required")

    updates: Dict[str, Optional[str]] = {}
    if email is not None:
        updates["email"] = email
    if access_token is not None:
        updates["access_token"] = access_token
    if token_type is not None:
        updates["token_type"] = token_type
    if scope is not None:
        updates["scope"] = scope
    if expires_at is not None:
        if isinstance(expires_at, datetime):
            expires_at = expires_at.astimezone(timezone.utc).isoformat()
        updates["expires_at"] = expires_at
    if imap_username is not None:
        updates["imap_username"] = imap_username
    if imap_password is not None:
        updates["imap_password"] = imap_password

    timestamp = datetime.now(timezone.utc).isoformat()
    updates["updated_at"] = timestamp

    url = DATABASE_URL
    with _get_conn(url) as conn:
        cur = _get_cursor(conn, url)
        placeholder = "%s" if _is_postgres(url) else "?"
        cur.execute(
            f"SELECT 1 FROM gmail_accounts WHERE provider = {placeholder} AND user_id = {placeholder}",
            (provider, user_id),
        )
        exists = cur.fetchone() is not None
        if exists:
            columns = ", ".join(f"{column} = {placeholder}" for column in updates.keys())
            params = tuple(updates.values()) + (provider, user_id)
            cur.execute(
                f"UPDATE gmail_accounts SET {columns} WHERE provider = {placeholder} AND user_id = {placeholder}",
                params,
            )
        else:
            columns = ["provider", "user_id"] + list(updates.keys())
            values = [provider, user_id] + list(updates.values())
            placeholders = ", ".join([placeholder] * len(values))
            cur.execute(
                f"INSERT INTO gmail_accounts ({', '.join(columns)}) VALUES ({placeholders})",
                tuple(values),
            )
        conn.commit()
    return get_account(provider, user_id) or {}


def get_account(provider: str, user_id: str) -> Optional[Dict[str, Optional[str]]]:
    """Return the stored Gmail account for ``provider`` and ``user_id``."""

    url = DATABASE_URL
    with _get_conn(url) as conn:
        cur = _get_cursor(conn, url)
        placeholder = "%s" if _is_postgres(url) else "?"
        cur.execute(
            f"""
            SELECT provider, user_id, email, access_token, token_type, scope, expires_at, updated_at, imap_username, imap_password
            FROM gmail_accounts
            WHERE provider = {placeholder} AND user_id = {placeholder}
            """,
            (provider, user_id),
        )
        row = cur.fetchone()
        if not row:
            return None
        if hasattr(row, "keys"):
            return dict(row)
        columns = [desc[0] for desc in cur.description]
        return dict(zip(columns, row))


def delete_account(provider: str, user_id: str) -> None:
    """Remove a stored Gmail account for the given user."""

    url = DATABASE_URL
    with _get_conn(url) as conn:
        cur = _get_cursor(conn, url)
        placeholder = "%s" if _is_postgres(url) else "?"
        cur.execute(
            f"DELETE FROM gmail_accounts WHERE provider = {placeholder} AND user_id = {placeholder}",
            (provider, user_id),
        )
        conn.commit()

