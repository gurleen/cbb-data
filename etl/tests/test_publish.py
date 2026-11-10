import gzip
import json

from cbb_etl import keys
from cbb_etl.encode import GzipJsonEncoder
from cbb_etl.load_motherduck import MotherDuckLoader
from cbb_etl.load_r2 import LocalStore, Manifest, Publisher
from cbb_etl.transform import build_season


def _build(paths):
    return build_season("mbb", 2026, paths, min_division_i=2)


def test_gzip_encoding_is_deterministic():
    e = GzipJsonEncoder()
    a, b = e.encode({"b": 1, "a": [1.5, None]}), e.encode({"a": [1.5, None], "b": 1})
    assert a.body == b.body and a.sha256 == b.sha256
    assert json.loads(gzip.decompress(a.body)) == {"a": [1.5, None], "b": 1}
    assert (a.content_type, a.content_encoding) == ("application/json", "gzip")


def test_publish_skips_unchanged_and_removes_stale(tmp_path, fixture_paths):
    store = LocalStore(tmp_path / "out")
    fps = {("mbb", 2026): {"schedules": "x"}}
    b = _build(fixture_paths)

    s1 = Publisher(store).publish([b], fps, {"mbb": {"schedules": "ts"}})
    assert s1.uploaded == len(b.documents) + 1  # + seasons.json
    assert (tmp_path / "out" / keys.team_key("mbb", 2026, 1)).exists()

    s2 = Publisher(store).publish([_build(fixture_paths)], fps, {})
    assert s2.uploaded == 0 and s2.skipped == len(b.documents)

    # a team disappears upstream -> its object is deleted
    b3 = _build(fixture_paths)
    del b3.documents[keys.team_key("mbb", 2026, 3)]
    s3 = Publisher(store).publish([b3], fps, {})
    assert s3.deleted == 1
    assert not (tmp_path / "out" / keys.team_key("mbb", 2026, 3)).exists()

    m = Manifest.load(store)
    assert m.sources["mbb/2026"] == {"schedules": "x"}
    assert m.upstream["mbb"] == {"schedules": "ts"}
    seasons = json.loads(gzip.decompress(store.get(keys.seasons_key("mbb"))))
    assert [s["season"] for s in seasons["seasons"]] == [2026]
    assert Publisher(store).season_unchanged("mbb", 2026, {"schedules": "x"})


def test_sync_file_uses_source_fingerprint(tmp_path, fixture_paths):
    store = LocalStore(tmp_path / "out")
    p = Publisher(store)
    key = keys.lake_key("mbb", "schedules", 2026)
    assert p.sync_file(key, fixture_paths["schedules"], "fp1")
    assert not p.sync_file(key, fixture_paths["schedules"], "fp1")
    assert p.sync_file(key, fixture_paths["schedules"], "fp2")
    p.save()
    assert Publisher(store).file_unchanged(key, "fp2")


def test_motherduck_tables_mode_is_idempotent(tmp_path, fixture_paths):
    loader = MotherDuckLoader(local_path=tmp_path / "cbb.duckdb")
    path = fixture_paths["schedules"]
    loader.load("mbb", 2026, "schedules", path, "fp1")
    assert loader.load("mbb", 2026, "schedules", path, "fp1").skipped
    loader.load("mbb", 2026, "schedules", path, "fp2")  # reload: delete + insert
    n = loader.con.execute("SELECT count(*) FROM cbb.mbb.schedules").fetchone()[0]
    assert n == 4
    loader.close()


def test_motherduck_views_over_lake(tmp_path, fixture_paths):
    store = LocalStore(tmp_path / "out")
    p = Publisher(store)
    for season in (2025, 2026):
        p.sync_file(
            keys.lake_key("mbb", "schedules", season), fixture_paths["schedules"], f"fp{season}"
        )
    loader = MotherDuckLoader(local_path=tmp_path / "cbb.duckdb")
    glob = tmp_path / "out" / keys.LAKE_PREFIX / "mbb" / "schedules" / "*" / "*.parquet"
    loader.refresh_view("mbb", "schedules", glob.as_posix())
    rows = loader.con.execute(
        "SELECT count(*) FROM cbb.mbb.schedules WHERE season = 2026"
    ).fetchone()[0]
    assert rows == 4  # partition column wins over the file's own season column
    loader.close()
