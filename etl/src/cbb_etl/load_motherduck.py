"""MotherDuck: database `cbb`, one schema per sport (`mbb`, `wbb`).

Default mode ("views"): every table is a VIEW over the Hive-partitioned parquet lake in R2
(`parquet/v1/{sport}/{table}/season=YYYY/data.parquet`), read with `union_by_name` so
schema drift between seasons is absorbed at query time. Nothing is stored in MotherDuck,
so its 10 GB free-tier limit doesn't apply; views pick up new season files automatically.

Optional mode ("tables", --md-mode tables): native tables, loaded as described below.
* One table per dataset.
* Idempotent per season: in one transaction, DELETE rows for the season, then INSERT.
  Tables are never dropped on a normal run.
* Transforms already ran locally; this module only uploads parquet (MotherDuck's hybrid
  execution reads the local file client-side), so no MotherDuck compute goes on rebuilds.
* `main._load_log` records the upstream fingerprint per (sport, season, table), so
  unchanged inputs are skipped.
* --dry-run writes to a local DuckDB file with the same layout instead.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import duckdb

from . import log

logger = log.get(__name__)

GB = 1024**3


def _q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


@dataclass
class LoadResult:
    table: str
    season: int
    rows: int
    skipped: bool = False


class MotherDuckLoader:
    def __init__(
        self,
        database: str = "cbb",
        token: str | None = None,
        local_path: Path | None = None,
        storage_limit_gb: float = 9.0,
    ):
        self.db = database
        self.storage_limit_bytes = int(storage_limit_gb * GB)
        self.local = local_path is not None
        if local_path is not None:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            # a file named cbb.duckdb attaches as catalog "cbb"
            self.con = duckdb.connect(str(local_path.with_name(f"{database}.duckdb")))
        else:
            if token:
                os.environ.setdefault("MOTHERDUCK_TOKEN", token)
            self.con = duckdb.connect("md:")
            self.con.execute(f"CREATE DATABASE IF NOT EXISTS {_q(database)}")
        self.con.execute(f"USE {_q(database)}")
        self.con.execute(f"""
            CREATE TABLE IF NOT EXISTS {_q(database)}.main._load_log (
                sport VARCHAR, season INTEGER, table_name VARCHAR, fingerprint VARCHAR,
                rows BIGINT, loaded_at TIMESTAMPTZ DEFAULT now())""")

    def close(self) -> None:
        self.con.close()

    # -- views over the R2 lake ----------------------------------------------------------
    def ensure_r2_secret(self, account_id: str, key_id: str, secret: str) -> None:
        """Persistent MotherDuck secret so views can read r2:// paths. Use a READ-ONLY R2
        token here (R2_READ_ACCESS_KEY_ID / R2_READ_SECRET_ACCESS_KEY)."""

        def lit(v: str) -> str:
            return "'" + v.replace("'", "''") + "'"

        self.con.execute(
            f"CREATE OR REPLACE SECRET cbb_r2 IN MOTHERDUCK (TYPE r2, KEY_ID {lit(key_id)}, "
            f"SECRET {lit(secret)}, ACCOUNT_ID {lit(account_id)})"
        )

    def refresh_view(self, sport: str, table: str, glob: str) -> None:
        """(Re)create `cbb.{sport}.{table}` as a view over `glob` (r2:// or local path).
        Refuses to replace a native table of the same name."""
        self.con.execute(f"CREATE SCHEMA IF NOT EXISTS {_q(self.db)}.{_q(sport)}")
        row = self.con.execute(
            "SELECT table_type FROM information_schema.tables WHERE table_catalog = ? "
            "AND table_schema = ? AND table_name = ?",
            [self.db, sport, table],
        ).fetchone()
        if row and row[0] != "VIEW":
            raise RuntimeError(
                f"{sport}.{table} is a native table; drop it manually before "
                "switching it to a view (normal runs never drop tables)"
            )
        src = glob.replace("'", "''")
        self.con.execute(
            f"CREATE OR REPLACE VIEW {_q(self.db)}.{_q(sport)}.{_q(table)} AS "
            f"SELECT * FROM read_parquet('{src}', hive_partitioning = true, "
            "union_by_name = true)"
        )
        logger.info("motherduck view refreshed", extra={"view": f"{sport}.{table}", "source": glob})

    # -- bookkeeping -----------------------------------------------------------------------
    def loaded_fingerprint(self, sport: str, season: int, table: str) -> str | None:
        row = self.con.execute(
            f"SELECT fingerprint FROM {_q(self.db)}.main._load_log "
            "WHERE sport = ? AND season = ? AND table_name = ? "
            "ORDER BY loaded_at DESC LIMIT 1",
            [sport, season, table],
        ).fetchone()
        return row[0] if row else None

    def _table_columns(self, schema: str, table: str) -> dict[str, str] | None:
        rows = self.con.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_catalog = ? AND table_schema = ? AND table_name = ? "
            "ORDER BY ordinal_position",
            [self.db, schema, table],
        ).fetchall()
        return {r[0]: r[1] for r in rows} if rows else None

    def _source_columns(self, path: Path) -> dict[str, str]:
        rows = self.con.execute(
            f"DESCRIBE SELECT * FROM read_parquet('{path.as_posix()}')"
        ).fetchall()
        return {r[0]: r[1] for r in rows}

    # -- loading ---------------------------------------------------------------------------
    def load(
        self, sport: str, season: int, table: str, path: Path, fingerprint: str, force: bool = False
    ) -> LoadResult:
        if not force and self.loaded_fingerprint(sport, season, table) == fingerprint:
            logger.info(
                "motherduck skip (unchanged)", extra={"table": f"{sport}.{table}", "season": season}
            )
            return LoadResult(table, season, 0, skipped=True)

        self.check_storage_budget(extra_bytes=path.stat().st_size)
        fq = f"{_q(self.db)}.{_q(sport)}.{_q(table)}"
        src_cols = self._source_columns(path)
        src = f"read_parquet('{path.as_posix()}')"
        # Force the season column to the file's season so DELETE/INSERT stay aligned.
        select_star = (
            f"SELECT * REPLACE ({season}::INTEGER AS season) FROM {src}"
            if "season" in src_cols
            else f"SELECT *, {season}::INTEGER AS season FROM {src}"
        )

        self.con.execute("BEGIN TRANSACTION")
        try:
            self.con.execute(f"CREATE SCHEMA IF NOT EXISTS {_q(self.db)}.{_q(sport)}")
            target = self._table_columns(sport, table)
            if target is None:
                self.con.execute(f"CREATE TABLE {fq} AS {select_star}")
            else:
                exprs = self._aligned_select(target, src_cols, season, fq)
                self.con.execute(f"DELETE FROM {fq} WHERE season = ?", [season])
                self.con.execute(f"INSERT INTO {fq} BY NAME SELECT {exprs} FROM {src}")
            (rows,) = self.con.execute(
                f"SELECT count(*) FROM {fq} WHERE season = ?", [season]
            ).fetchone()
            self.con.execute(
                f"DELETE FROM {_q(self.db)}.main._load_log "
                "WHERE sport = ? AND season = ? AND table_name = ?",
                [sport, season, table],
            )
            self.con.execute(
                f"INSERT INTO {_q(self.db)}.main._load_log "
                "(sport, season, table_name, fingerprint, rows) VALUES (?, ?, ?, ?, ?)",
                [sport, season, table, fingerprint, rows],
            )
            self.con.execute("COMMIT")
        except Exception:
            self.con.execute("ROLLBACK")
            raise
        logger.info(
            "motherduck loaded",
            extra={
                "table": f"{sport}.{table}",
                "season": season,
                "rows": rows,
                "estimated_storage": self.storage_report(),
            },
        )
        return LoadResult(table, season, rows)

    def _aligned_select(
        self, target: dict[str, str], src: dict[str, str], season: int, fq: str
    ) -> str:
        """Handle schema drift between seasons: add new columns to the table, cast
        mismatched types to the table's type (TRY_CAST; VARCHAR targets cast directly)."""
        for col, typ in src.items():
            if col not in target:
                logger.warning(
                    "schema drift: adding column", extra={"table": fq, "column": col, "type": typ}
                )
                self.con.execute(f"ALTER TABLE {fq} ADD COLUMN {_q(col)} {typ}")
                target[col] = typ
        exprs = []
        for col, typ in src.items():
            if col == "season":
                exprs.append(f"{season}::INTEGER AS season")
            elif target[col] == typ:
                exprs.append(_q(col))
            else:
                cast = "CAST" if target[col] == "VARCHAR" else "TRY_CAST"
                exprs.append(f"{cast}({_q(col)} AS {target[col]}) AS {_q(col)}")
        if "season" not in src:
            exprs.append(f"{season}::INTEGER AS season")
        return ", ".join(exprs)

    # -- storage ---------------------------------------------------------------------------
    def storage_bytes(self) -> int | None:
        queries = (
            []
            if self.local
            else [
                "SELECT sum(active_bytes) FROM md_information_schema.storage_info "
                f"WHERE database_name = '{self.db}'",
            ]
        )
        queries.append(
            "SELECT sum(CAST(regexp_replace(database_size, '[^0-9.]', '', 'g')"
            " AS DOUBLE) * CASE WHEN database_size LIKE '%GiB' THEN 1073741824"
            " WHEN database_size LIKE '%MiB' THEN 1048576"
            " WHEN database_size LIKE '%KiB' THEN 1024 ELSE 1 END)"
            f" FROM pragma_database_size() WHERE database_name = '{self.db}'"
        )
        for q in queries:
            try:
                (v,) = self.con.execute(q).fetchone()
                if v is not None:
                    return int(v)
            except duckdb.Error:
                continue
        return None

    def storage_report(self) -> str:
        b = self.storage_bytes()
        return "unknown" if b is None else f"{b / GB:.2f} GB"

    def check_storage_budget(self, extra_bytes: int = 0) -> None:
        b = self.storage_bytes()
        if b is not None and b + extra_bytes > self.storage_limit_bytes:
            raise RuntimeError(
                f"MotherDuck storage would exceed budget: {b / GB:.2f} GB used + "
                f"{extra_bytes / GB:.2f} GB incoming > {self.storage_limit_bytes / GB:.1f} GB. "
                "Lower --max-seasons, skip --include-pbp, or raise --md-storage-limit-gb."
            )
