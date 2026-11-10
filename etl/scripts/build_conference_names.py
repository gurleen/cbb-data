"""Regenerate etl/sql/conference_names.csv: the most recent name ESPN used for each
conference id, across every season of schedules + standings for both sports.

Used only as the last fallback in teams.sql, for seasons where a conference played no
games flagged as conference games and standings are missing it (e.g. Southland, 2010).

    uv run python scripts/build_conference_names.py
"""

from __future__ import annotations

from pathlib import Path

import duckdb

from cbb_etl.config import SPORT_CONFIG, Settings
from cbb_etl.extract import AssetNotFound, ReleaseClient
from cbb_etl.seasons import current_season
from cbb_etl.transform import sql_dir


def main() -> None:
    settings = Settings.from_env()
    client = ReleaseClient(settings.cache_dir, settings.github_token)
    con = duckdb.connect()
    con.execute(
        "CREATE TABLE names (conference_id INTEGER, season INTEGER, name VARCHAR, "
        "short_name VARCHAR, src INTEGER)"
    )
    for sp in SPORT_CONFIG.values():
        for season in range(2002, current_season() + 1):
            for ds in ("schedules", "standings"):
                try:
                    path = client.fetch(client.resolve(sp, sp.dataset(ds), season))
                except AssetNotFound:
                    continue
                if ds == "schedules":
                    con.execute(f"""INSERT INTO names SELECT groups_id, {season}, groups_name,
                        groups_short_name, 1 FROM read_parquet('{path}')
                        WHERE groups_is_conference AND groups_id IS NOT NULL""")
                else:
                    con.execute(f"""INSERT INTO names SELECT TRY_CAST(group_id AS INTEGER),
                        {season}, group_name, group_short_name, 0 FROM read_parquet('{path}')
                        WHERE TRY_CAST(group_id AS INTEGER) IS NOT NULL""")
    out = sql_dir() / "conference_names.csv"
    con.execute(f"""COPY (
        SELECT conference_id,
               arg_max(name, season * 10 + src) AS conference_name,
               arg_max(short_name, season * 10 + src) AS conference_short_name
        FROM names WHERE name IS NOT NULL GROUP BY 1 ORDER BY 1
    ) TO '{out}' (HEADER)""")
    print(f"wrote {out} ({Path(out).read_text().count(chr(10)) - 1} conferences)")


if __name__ == "__main__":
    main()
