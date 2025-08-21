import asyncio
import csv
from pathlib import Path

from backend.agents.sql import SQLQueryExecutorAgent


def test_executor_handles_fenced_sql(tmp_path):
    csv_path = tmp_path / "listings.csv"
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
                "Address": "1 Budget St",
                "City": "Cheapville",
                "State": "CA",
                "List Price": "500",
                "Property Subtype": "House",
                "Image": "",
                "Latitude": "0",
                "Longitude": "0",
            }
        )

    agent = SQLQueryExecutorAgent(csv_path)
    query = "```sql\nSELECT * FROM properties WHERE price < 1000\n```"
    result = asyncio.run(agent.handle(query))
    rows = result.get("content", [])
    assert len(rows) == 1
    assert rows[0]["address"] == "1 Budget St"
