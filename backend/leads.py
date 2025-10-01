from __future__ import annotations

import os
import sqlite3
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

try:  # pragma: no cover - allow running as package or script
    from . import auth
except ImportError:  # fallback for running from backend directory
    import auth

get_current_user = auth.get_current_user

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
                creator_email TEXT,
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
                creator_email TEXT,
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
    # Add columns if upgrading from an older schema
    for col in ("user_email", "creator_email"):
        try:
            cur.execute(
                f"ALTER TABLE leads ADD COLUMN {col} TEXT"
                if not _is_postgres()
                else f"ALTER TABLE leads ADD COLUMN IF NOT EXISTS {col} TEXT"
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

    The request must include authenticated user information. When authentication
    is disabled (e.g. in tests or local development) a user object may still be
    supplied via dependency overrides and will be respected so leads remain
    scoped per-user. If no user information is available the request is
    rejected.
    """

    if user and "sub" in user:
        # Respect explicitly provided user objects even when the global
        # authentication flag is disabled so that tests or alternative auth
        # providers can still scope leads per-user.
        return user["sub"], user.get("email", "")

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


def get_leads_for_user(user_id: str, user_email: str | None = None) -> List[dict]:
    """Return all leads stored for ``user_id`` and ``user_email``.

    The lookup mirrors the scoping used by the API endpoints so callers outside
    of the FastAPI router receive the same per-user isolation guarantees.
    ``user_email`` is optional to support identity providers that do not supply
    an email address; in that case the leads are keyed by the empty string.
    """

    if not user_id:
        raise ValueError("user_id is required to fetch leads")

    normalized_email = user_email or ""
    with _get_conn() as conn:
        cur = _get_cursor(conn)
        cur.execute(
            (
                "SELECT * FROM leads WHERE user_id = ? AND creator_email = ?"
                if not _is_postgres()
                else "SELECT * FROM leads WHERE user_id = %s AND creator_email = %s"
            ),
            (user_id, normalized_email),
        )
        rows = cur.fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("/leads")
def list_leads(user: dict | None = Depends(get_current_user)) -> List[dict]:
    """Return leads belonging to the current user's identity.

    Leads are scoped by both the user's unique identifier and email address to
    avoid collisions when either value is duplicated across accounts.
    """

    uid, email = _user_identity(user)
    return get_leads_for_user(uid, email)


@router.post("/leads")
def create_lead(payload: LeadCreate, user: dict | None = Depends(get_current_user)) -> dict:
    uid, email = _user_identity(user)
    values = (
        uid,
        email,
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
                "INSERT INTO leads (user_id, user_email, creator_email, name, stage, property, email, phone, listing_number, address, notes) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            if not _is_postgres()
            else (
                "INSERT INTO leads (user_id, user_email, creator_email, name, stage, property, email, phone, listing_number, address, notes) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id"
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
        "UPDATE leads SET {cols} WHERE user_id = {uid} AND creator_email = {email} AND id = {id}".format(
            cols=', '.join(columns),
            uid='%s' if _is_postgres() else '?',
            email='%s' if _is_postgres() else '?',
            id='%s' if _is_postgres() else '?',
        )
    )
    with _get_conn() as conn:
        cur = _get_cursor(conn)
        cur.execute(query, tuple(values))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Lead not found")
        conn.commit()
    return {"status": "ok"}


@router.delete("/leads/{lead_id}")
def delete_lead(lead_id: int, user: dict | None = Depends(get_current_user)) -> dict:
    """Remove a lead belonging to the current user.

    The operation is scoped by both user ID and email to ensure one user cannot
    delete another user's leads.
    """

    uid, email = _user_identity(user)
    with _get_conn() as conn:
        cur = _get_cursor(conn)
        cur.execute(
            (
                "DELETE FROM leads WHERE user_id = ? AND creator_email = ? AND id = ?"
                if not _is_postgres()
                else "DELETE FROM leads WHERE user_id = %s AND creator_email = %s AND id = %s"
            ),
            (uid, email, lead_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Lead not found")
        conn.commit()
    return {"status": "ok"}
