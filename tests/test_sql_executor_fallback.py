import asyncio
import csv
from pathlib import Path

from backend.agents.sql import SQLQueryExecutorAgent


def test_executor_falls_back_to_singular_filename(tmp_path):
    csv_path = tmp_path / "listing.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(
            f,
            [
                "Listing Number",
                "Address",
                "City",
                "State",
                "List Price",
                "Property Subtype",
                "Image",
                "Latitude",
                "Longitude",
            ],
        )
        writer.writeheader()
        writer.writerow(
            {
                "Listing Number": "1",
                "Address": "123 Main St",
                "City": "Doral",
                "State": "FL",
                "List Price": "1000000",
                "Property Subtype": "Warehouse",
                "Image": "",
                "Latitude": "0",
                "Longitude": "0",
            }
        )

    # Provide a path that points to a non-existent "listings.csv"
    agent = SQLQueryExecutorAgent(csv_path.with_name("listings.csv"))

    result = asyncio.run(agent.handle("SELECT * FROM properties"))
    rows = result.get("content", [])
    assert len(rows) == 1
    assert rows[0]["address"] == "123 Main St"
