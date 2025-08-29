from __future__ import annotations

import os
import sqlite3
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

try:  # pragma: no cover - allow running as package or script
    from .auth import get_current_user
except ImportError:  # fallback for running from backend directory
    from auth import get_current_user

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


def _user_id(user: dict | None) -> str:
    return user.get("sub") if user else "default"


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
    uid = _user_id(user)
    with _get_conn() as conn:
        cur = _get_cursor(conn)
        cur.execute(
            "SELECT * FROM leads WHERE user_id = ?" if not _is_postgres() else "SELECT * FROM leads WHERE user_id = %s",
            (uid,),
        )
        rows = cur.fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post("/leads")
def create_lead(payload: LeadCreate, user: dict | None = Depends(get_current_user)) -> dict:
    uid = _user_id(user)
    values = (
        uid,
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
                "INSERT INTO leads (user_id, name, stage, property, email, phone, listing_number, address, notes) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            if not _is_postgres()
            else (
                "INSERT INTO leads (user_id, name, stage, property, email, phone, listing_number, address, notes) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id"
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
    uid = _user_id(user)
    data = payload.model_dump(exclude_unset=True)
    if not data:
        return {"status": "ok"}
    columns = []
    values = []
    for field, value in data.items():
        column = "listing_number" if field == "listingNumber" else field
        columns.append(f"{column} = {'%s' if _is_postgres() else '?'}")
        values.append(value)
    values.extend([uid, lead_id])
    query = (
        f"UPDATE leads SET {', '.join(columns)} WHERE user_id = {'%s' if _is_postgres() else '?'} AND id = {'%s' if _is_postgres() else '?'}"
    )
    with _get_conn() as conn:
        cur = _get_cursor(conn)
        cur.execute(query, tuple(values))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Lead not found")
        conn.commit()
    return {"status": "ok"}
