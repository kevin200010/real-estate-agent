"""Persistence helpers for property listings.

This module centralises how property data is stored so both the API layer and
background workers can access the same database.  It relies on SQLAlchemy Core
so we can target SQLite for local development and PostgreSQL on AWS without
changing application code.  The connection string is controlled by the
``PROPERTIES_DB_URL`` environment variable and defaults to a SQLite file under
``backend/data``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.engine import Engine, Row
from sqlalchemy.exc import IntegrityError as SQLAlchemyIntegrityError

IntegrityError = SQLAlchemyIntegrityError
from sqlalchemy.sql import Select


DATA_DIR = Path(__file__).resolve().parent / "data"
DEFAULT_SQLITE_PATH = DATA_DIR / "properties.db"


def _build_engine() -> Engine:
    """Return the SQLAlchemy engine configured from the environment."""

    url = os.getenv("PROPERTIES_DB_URL")
    if not url:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        url = f"sqlite:///{DEFAULT_SQLITE_PATH}"  # pragma: no cover - env dependent

    connect_args: dict[str, Any] = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    return create_engine(url, future=True, connect_args=connect_args)


engine: Engine = _build_engine()
metadata = MetaData()


properties_table = Table(
    "properties",
    metadata,
    Column("id", String, primary_key=True),
    Column("listing_number", String, nullable=True),
    Column("address", String, nullable=False),
    Column("city", String, nullable=True),
    Column("state", String, nullable=True),
    Column("zip_code", String, nullable=True),
    Column("price", String, nullable=True),
    Column("beds", Float, nullable=True),
    Column("baths", Float, nullable=True),
    Column("year_built", Integer, nullable=True),
    Column("status", String, nullable=True),
    Column("property_type", String, nullable=True),
    Column("sale_or_rent", String, nullable=True),
    Column("lat", Float, nullable=True),
    Column("lng", Float, nullable=True),
    Column("in_system", Boolean, nullable=False, server_default="1"),
    Column("removed_at", DateTime, nullable=True),
    Column("metadata", Text, nullable=True),
    Column("created_at", DateTime, nullable=False, default=datetime.utcnow),
    Column("updated_at", DateTime, nullable=False, default=datetime.utcnow),
)


@dataclass(slots=True)
class PropertyRecord:
    """Typed representation of a property row."""

    id: str
    address: str
    listing_number: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    zip_code: Optional[str] = None
    price: Optional[str] = None
    beds: Optional[float] = None
    baths: Optional[float] = None
    year_built: Optional[int] = None
    status: Optional[str] = None
    property_type: Optional[str] = None
    sale_or_rent: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    in_system: bool = True
    removed_at: Optional[datetime] = None
    metadata: Optional[dict[str, Any]] = None

    def to_api(self) -> dict[str, Any]:
        """Return a JSON-serialisable representation using camelCase keys."""

        return {
            "id": self.id,
            "listingNumber": self.listing_number,
            "address": self.address,
            "city": self.city,
            "state": self.state,
            "zipCode": self.zip_code,
            "price": self.price,
            "beds": self.beds,
            "baths": self.baths,
            "year": self.year_built,
            "status": self.status,
            "type": self.property_type,
            "saleOrRent": self.sale_or_rent,
            "lat": self.lat,
            "lng": self.lng,
            "inSystem": self.in_system,
            "removedAt": self.removed_at.isoformat() if self.removed_at else None,
            "metadata": self.metadata or {},
        }


def init_db(seed_sources: Iterable[Path] | None = None) -> None:
    """Create tables and seed data if the properties table is empty."""

    metadata.create_all(engine)

    candidates: List[Path] = []
    if seed_sources:
        candidates.extend(Path(p) for p in seed_sources)

    seed_env = os.getenv("PROPERTIES_SEED_CSV")
    if seed_env:
        for item in seed_env.split(os.pathsep):
            candidate = Path(item.strip())
            if candidate.exists():
                candidates.append(candidate)

    project_root = Path(__file__).resolve().parents[1]
    default_csv = project_root / "frontend" / "data" / "listings.csv"
    if default_csv.exists():
        candidates.append(default_csv)

    if not candidates:
        return

    with engine.begin() as conn:
        count = conn.execute(select(func.count()).select_from(properties_table)).scalar()
        if count and count > 0:
            return

        for csv_path in candidates:
            if not csv_path.exists() or csv_path.suffix.lower() != ".csv":
                continue
            for row in _read_csv(csv_path):
                try:
                    conn.execute(insert(properties_table).values(**row))
                except SQLAlchemyIntegrityError:
                    continue


def list_properties() -> list[dict[str, Any]]:
    """Return all property records ordered by address."""

    stmt: Select = select(properties_table).order_by(properties_table.c.address.asc())
    with engine.connect() as conn:
        rows = conn.execute(stmt).all()
    return [PropertyRecord(**_row_to_record(row)).to_api() for row in rows]


def create_property(payload: Mapping[str, Any]) -> dict[str, Any]:
    """Insert a property and return the stored record."""

    data = _normalise_payload(payload)
    with engine.begin() as conn:
        conn.execute(insert(properties_table).values(**data))
        row = conn.execute(
            select(properties_table).where(properties_table.c.id == data["id"])
        ).one()
    return PropertyRecord(**_row_to_record(row)).to_api()


def set_in_system(property_id: str, in_system: bool) -> dict[str, Any]:
    """Update the in_system flag for ``property_id`` and return the row."""

    timestamp = datetime.utcnow() if not in_system else None
    with engine.begin() as conn:
        result = conn.execute(
            update(properties_table)
            .where(properties_table.c.id == property_id)
            .values(
                in_system=in_system,
                removed_at=timestamp,
                updated_at=datetime.utcnow(),
            )
            .returning(properties_table)
        )
        row = result.first()
        if row is None:
            raise KeyError(property_id)
    return PropertyRecord(**_row_to_record(row)).to_api()


def _row_to_record(row: Row[Any]) -> dict[str, Any]:
    data = dict(row._mapping)
    data.pop("created_at", None)
    data.pop("updated_at", None)
    meta = data.get("metadata")
    if isinstance(meta, str) and meta:
        try:
            data["metadata"] = json.loads(meta)
        except json.JSONDecodeError:  # pragma: no cover - defensive
            data["metadata"] = {}
    elif meta is None:
        data["metadata"] = {}
    return data


def _normalise_payload(payload: Mapping[str, Any]) -> Dict[str, Any]:
    data: MutableMapping[str, Any] = dict(payload)
    identifier = str(data.pop("id", "") or data.get("listingNumber") or uuid4())

    metadata_blob = data.pop("metadata", None)
    metadata_payload: dict[str, Any] = {}
    if isinstance(metadata_blob, Mapping):
        metadata_payload = dict(metadata_blob)

    data_map: Dict[str, Any] = {
        "id": identifier,
        "listing_number": _maybe_str(data.get("listingNumber")),
        "address": _require_str(data.get("address")),
        "city": _maybe_str(data.get("city")),
        "state": _maybe_str(data.get("state")),
        "zip_code": _maybe_str(data.get("zipCode")),
        "price": _maybe_str(data.get("price") or data.get("listPrice")),
        "beds": _maybe_float(data.get("beds") or data.get("bedrooms")),
        "baths": _maybe_float(data.get("baths") or data.get("bathrooms")),
        "year_built": _maybe_int(data.get("year") or data.get("yearBuilt")),
        "status": _maybe_str(data.get("status") or data.get("listingStatus")),
        "property_type": _maybe_str(data.get("type") or data.get("propertyType")),
        "sale_or_rent": _maybe_str(data.get("saleOrRent")),
        "lat": _maybe_float(data.get("lat") or data.get("latitude")),
        "lng": _maybe_float(data.get("lng") or data.get("longitude")),
        "in_system": bool(data.get("inSystem", True)),
        "metadata": json.dumps(metadata_payload or _extract_metadata(data)),
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
    }
    return data_map


def _extract_metadata(raw: Mapping[str, Any]) -> dict[str, Any]:
    ignore = {
        "listingNumber",
        "address",
        "city",
        "state",
        "zipCode",
        "price",
        "beds",
        "bedrooms",
        "baths",
        "bathrooms",
        "year",
        "yearBuilt",
        "status",
        "listingStatus",
        "type",
        "propertyType",
        "saleOrRent",
        "lat",
        "latitude",
        "lng",
        "longitude",
        "inSystem",
    }
    return {k: v for k, v in raw.items() if k not in ignore}


def _read_csv(path: Path) -> Iterable[Dict[str, Any]]:
    import csv

    with path.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            cleaned = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
            baths = _safe_float(cleaned.get("Full Bathrooms")) + 0.5 * _safe_float(
                cleaned.get("Half Bathrooms")
            )
            metadata = {
                "listingAgentName": cleaned.get("Listing Agent Name"),
                "listingOfficeName": cleaned.get("Listing Office Name"),
                "county": cleaned.get("County"),
                "subdivision": cleaned.get("Subdivision"),
            }
            yield {
                "id": cleaned.get("Listing Number") or str(uuid4()),
                "listing_number": cleaned.get("Listing Number"),
                "address": cleaned.get("Address"),
                "city": cleaned.get("City"),
                "state": cleaned.get("State"),
                "zip_code": cleaned.get("Zip Code"),
                "price": cleaned.get(" List Price "),
                "beds": _safe_float(cleaned.get("Bedrooms")),
                "baths": baths if baths else None,
                "year_built": _safe_int(cleaned.get("Year Built")),
                "status": cleaned.get("Listing Status"),
                "property_type": cleaned.get("Property Type"),
                "sale_or_rent": cleaned.get("Sale or Rent"),
                "lat": _safe_float(cleaned.get("Latitude")),
                "lng": _safe_float(cleaned.get("Longitude")),
                "metadata": json.dumps(metadata),
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow(),
            }


def _require_str(value: Any) -> str:
    if not value:
        raise ValueError("Address is required")
    return str(value)


def _maybe_str(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    return str(value)


def _maybe_float(value: Any) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _maybe_int(value: Any) -> Optional[int]:
    try:
        return int(float(value)) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _safe_float(value: Any) -> float:
    try:
        return float(str(value).replace(",", "").replace("$", ""))
    except (TypeError, ValueError):
        return 0.0


def _safe_int(value: Any) -> Optional[int]:
    try:
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None


# Initialise the database when the module is imported.
init_db()

