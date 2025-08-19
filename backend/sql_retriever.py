from __future__ import annotations

import csv
import json
import sqlite3
import logging
from pathlib import Path
from typing import Dict, List, Any


logger = logging.getLogger(__name__)


class SQLPropertyRetriever:
    """Load property data into a SQLite database and query it with SQL."""

    def __init__(self, data_file: Path | str) -> None:
        path = Path(data_file).resolve()
        self.conn = sqlite3.connect(":memory:")
        self.conn.row_factory = sqlite3.Row
        self._create_table()
        self._load_data(path)

    def _create_table(self) -> None:
        self.conn.execute(
            """
            CREATE TABLE IF NOT EXISTS properties (
                id TEXT,
                address TEXT,
                location TEXT,
                price INTEGER,
                description TEXT,
                image TEXT,
                lat REAL,
                lng REAL
            )
            """
        )

    def _load_data(self, path: Path) -> None:
        if path.suffix.lower() == ".csv":
            with path.open("r", encoding="utf-8", newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    cleaned = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
                    self.conn.execute(
                        "INSERT INTO properties (id, address, location, price, description, image, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            cleaned.get("Listing Number"),
                            cleaned.get("Address"),
                            f"{cleaned.get('City', '')}, {cleaned.get('State', '')}".strip(", "),
                            self._parse_price(cleaned.get("List Price")),
                            cleaned.get("Property Subtype"),
                            cleaned.get("Image"),
                            self._parse_float(cleaned.get("Latitude")),
                            self._parse_float(cleaned.get("Longitude")),
                        ),
                    )
        else:
            with path.open("r", encoding="utf-8") as f:
                data = json.load(f)
                for item in data:
                    self.conn.execute(
                        "INSERT INTO properties (id, address, location, price, description, image, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            item.get("id"),
                            item.get("address"),
                            item.get("location"),
                            item.get("price"),
                            item.get("description"),
                            item.get("image"),
                            self._parse_float(item.get("lat") or item.get("latitude")),
                            self._parse_float(item.get("lng") or item.get("longitude")),
                        ),
                    )
        self.conn.commit()

    @staticmethod
    def _parse_price(value: Any) -> int | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return int(value)
        try:
            return int(float(str(value).replace("$", "").replace(",", "")))
        except ValueError:
            return None

    @staticmethod
    def _parse_float(value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def search(self, query: str) -> List[Dict[str, Any]]:
        words = [w.lower() for w in query.split() if w]
        if not words:
            return []
        like_clauses = []
        params: List[Any] = []
        for w in words:
            like = f"%{w}%"
            like_clauses.append("LOWER(address) LIKE ?")
            params.append(like)
            like_clauses.append("LOWER(location) LIKE ?")
            params.append(like)
            like_clauses.append("LOWER(description) LIKE ?")
            params.append(like)
        sql = (
            "SELECT id, address, location, price, description, image, lat, lng FROM properties "
            f"WHERE {' OR '.join(like_clauses)}"
        )
        logger.info("Executing SQL query: %s; params: %s", sql, params)
        cur = self.conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        # Score rows by number of matching words
        scored: List[tuple[int, Dict[str, Any]]] = []
        for row in rows:
            text = " ".join(
                [str(row.get("address", "")), str(row.get("location", "")), str(row.get("description", ""))]
            ).lower()
            score = sum(w in text for w in words)
            if score:
                scored.append((score, row))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [r for _, r in scored]
