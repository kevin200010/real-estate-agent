from __future__ import annotations

import os
import sqlite3
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

try:  # pragma: no cover - allow running as package or script
    from .auth import AUTH_ENABLED, get_current_user
except ImportError:  # fallback for running from backend directory
    from auth import AUTH_ENABLED, get_current_user

try:  # Optional dependency for PostgreSQL
    import psycopg2  # type: ignore
    import psycopg2.extras  # type: ignore
except Exception:  # pragma: no cover
    psycopg2 = None  # type: ignore

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./leads.db")


def _is_postgres() -> bool:
    return DATABASE_URL.startswith("postgres") and psycopg2 is not None


def _get_conn():
    if _is_postgres():
        return psycopg2.connect(DATABASE_URL)
    path = DATABASE_URL.replace("sqlite:///", "")
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _get_cursor(conn):
    if _is_postgres():
        return conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    return conn.cursor()


# Ensure table exists
with _get_conn() as _conn:
    cur = _get_cursor(_conn)
    cur.execute(
        (
            """
            CREATE TABLE IF NOT EXISTS leads (
                id SERIAL PRIMARY KEY,
                user_id TEXT,
                user_email TEXT,
                name TEXT NOT NULL,
                stage TEXT NOT NULL,
                property TEXT,
                email TEXT,
                phone TEXT,
                listing_number TEXT,
                address TEXT,
                notes TEXT
            )
            """
        )
        if _is_postgres()
        else (
            """
            CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                user_email TEXT,
                name TEXT NOT NULL,
                stage TEXT NOT NULL,
                property TEXT,
                email TEXT,
                phone TEXT,
                listing_number TEXT,
                address TEXT,
                notes TEXT
            )
            """
        )
    )
    _conn.commit()
    # Add user_email column if upgrading from an older schema
    try:
        cur.execute(
            "ALTER TABLE leads ADD COLUMN user_email TEXT"
            if not _is_postgres()
            else "ALTER TABLE leads ADD COLUMN IF NOT EXISTS user_email TEXT"
        )
        _conn.commit()
    except Exception:
        pass


router = APIRouter()


class LeadCreate(BaseModel):
    name: str
    stage: str = "New"
    property: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    listingNumber: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class LeadUpdate(BaseModel):
    name: Optional[str] = None
    stage: Optional[str] = None
    property: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    listingNumber: Optional[str] = None
    address: Optional[str] = None
    notes: Optional[str] = None


def _user_identity(user: dict | None) -> tuple[str, str]:
    """Return the identifier and email for the current user.

    When authentication is disabled (e.g. during local development), we fall
    back to a stable "local" user so that API calls still function and data is
    persisted. In production, a missing user results in a 401 response.
    """

    if user and "sub" in user:
        return user["sub"], user.get("email", "")

    if not AUTH_ENABLED:
        # In development environments without authentication configured we
        # still want the API to function. Use deterministic identifiers so data
        # remains isolated when auth is later enabled.
        return (
            os.getenv("LOCAL_DEV_USER", "local-user"),
            os.getenv("LOCAL_DEV_EMAIL", "local@example.com"),
        )

    raise HTTPException(
        status_code=401,
        detail="Not authenticated. Ensure your request includes a valid Authorization header",
    )


def _row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "stage": row["stage"],
        "property": row["property"],
        "email": row["email"],
        "phone": row["phone"],
        "listingNumber": row["listing_number"],
        "address": row["address"],
        "notes": row["notes"],
    }


@router.get("/leads")
def list_leads(user: dict | None = Depends(get_current_user)) -> List[dict]:
    uid, email = _user_identity(user)
    with _get_conn() as conn:
        cur = _get_cursor(conn)
        cur.execute(
            (
                "SELECT * FROM leads WHERE user_id = ? AND user_email = ?"
                if not _is_postgres()
                else "SELECT * FROM leads WHERE user_id = %s AND user_email = %s"
            ),
            (uid, email),
        )
        rows = cur.fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post("/leads")
def create_lead(payload: LeadCreate, user: dict | None = Depends(get_current_user)) -> dict:
    uid, email = _user_identity(user)
    values = (
        uid,
        email,
        payload.name,
        payload.stage,
        payload.property,
        payload.email,
        payload.phone,
        payload.listingNumber,
        payload.address,
        payload.notes,
    )
    with _get_conn() as conn:
        cur = _get_cursor(conn)
        cur.execute(
            (
                "INSERT INTO leads (user_id, user_email, name, stage, property, email, phone, listing_number, address, notes) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            if not _is_postgres()
            else (
                "INSERT INTO leads (user_id, user_email, name, stage, property, email, phone, listing_number, address, notes) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id"
            ),
            values,
        )
        if _is_postgres():
            lead_id = cur.fetchone()[0]
        else:
            lead_id = cur.lastrowid
        conn.commit()
    return {"id": lead_id}


@router.put("/leads/{lead_id}")
def update_lead(
    lead_id: int, payload: LeadUpdate, user: dict | None = Depends(get_current_user)
) -> dict:
    uid, email = _user_identity(user)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return {"status": "ok"}
    columns = []
    values = []
    for field, value in data.items():
        column = "listing_number" if field == "listingNumber" else field
        columns.append(f"{column} = {'%s' if _is_postgres() else '?'}")
        values.append(value)
    values.extend([uid, email, lead_id])
    query = (
        f"UPDATE leads SET {', '.join(columns)} WHERE user_id = {'%s' if _is_postgres() else '?'} AND user_email = {'%s' if _is_postgres() else '?'} AND id = {'%s' if _is_postgres() else '?'}"
    )
    with _get_conn() as conn:
        cur = _get_cursor(conn)
        cur.execute(query, tuple(values))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Lead not found")
        conn.commit()
    return {"status": "ok"}
