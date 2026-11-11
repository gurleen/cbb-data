import contextlib
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


def test_hash_shards_keep_main_manifest_small(tmp_path, fixture_paths):
    from cbb_etl.load_r2 import shard_of

    assert shard_of("v1/mbb/2026/teams/1.json") == "v1/mbb/2026/_hashes.json"
    assert shard_of("v1/wbb/players/9.json") == "v1/wbb/players/_hashes.json"
    assert shard_of("v1/mbb/seasons.json") is None
    assert shard_of("parquet/v1/mbb/pbp/season=2026/data.parquet") is None

    store = LocalStore(tmp_path / "out")
    b = _build(fixture_paths)
    Publisher(store).publish([b], {("mbb", 2026): {"x": "1"}}, {},
                             extra_docs={"v1/mbb/players/7.json": {"p": 7}})  # fmt: skip
    m = Manifest.load(store)
    assert set(m.objects) == {"v1/mbb/seasons.json"}
    shard = json.loads(gzip.decompress(store.get("v1/mbb/2026/_hashes.json")))
    assert set(shard) == set(b.documents)
    assert json.loads(gzip.decompress(store.get("v1/mbb/players/_hashes.json"))) == {
        "v1/mbb/players/7.json": shard_of and Publisher(store)._known_sha("v1/mbb/players/7.json")
    }
    s2 = Publisher(store).publish([_build(fixture_paths)], {("mbb", 2026): {"x": "1"}}, {},
                                  extra_docs={"v1/mbb/players/7.json": {"p": 7}})  # fmt: skip
    assert s2.uploaded == 0


def test_migrates_legacy_manifest_entries(tmp_path, fixture_paths):
    store = LocalStore(tmp_path / "out")
    b = _build(fixture_paths)
    Publisher(store).publish([b], {("mbb", 2026): {"x": "1"}}, {})
    # rewrite the manifest in the old (unsharded) format
    shard = json.loads(gzip.decompress(store.get("v1/mbb/2026/_hashes.json")))
    store.delete(["v1/mbb/2026/_hashes.json"])
    m = Manifest.load(store)
    m.objects.update({k: {"sha256": v + "0" * 32} for k, v in shard.items()})
    store.put("v1/manifest.json", GzipJsonEncoder().encode(m.to_json()))
    s = Publisher(store).publish([_build(fixture_paths)], {("mbb", 2026): {"x": "1"}}, {})
    assert s.uploaded == 0 and s.skipped == len(b.documents)
    assert set(Manifest.load(store).objects) == {"v1/mbb/seasons.json"}


def test_failed_upload_keeps_checkpointed_hashes(tmp_path, fixture_paths, monkeypatch):
    import cbb_etl.load_r2 as lr

    monkeypatch.setattr(lr, "UPLOAD_CHUNK", 2)
    store = LocalStore(tmp_path / "out")
    real_put = store.put
    calls = {"n": 0}

    def flaky(key, obj):
        if key.endswith("teams/3.json"):
            raise RuntimeError("boom")
        calls["n"] += 1
        real_put(key, obj)

    monkeypatch.setattr(store, "put", flaky)
    b = _build(fixture_paths)
    with contextlib.suppress(RuntimeError):
        Publisher(store).publish([b], {("mbb", 2026): {"x": "1"}}, {})
    monkeypatch.setattr(store, "put", real_put)
    s = Publisher(store).publish([_build(fixture_paths)], {("mbb", 2026): {"x": "1"}}, {})
    # objects from completed chunks were checkpointed and are skipped on the retry
    assert s.skipped > 0
    assert s.uploaded + s.skipped == len(b.documents) + 1  # + seasons.json


def test_adaptive_limit_backs_off_and_recovers():
    from cbb_etl.load_r2 import AdaptiveLimit

    lim = AdaptiveLimit(48, low=4, grow_after=2, cooldown=0)
    for _ in range(5):
        lim.acquire()
        lim.release(throttled=True)
    assert lim.limit == 4  # 48 -> 24 -> 12 -> 6 -> 4 (floor)
    for _ in range(6):
        lim.acquire()
        lim.release()
    assert lim.limit == 7  # +1 per 2 clean uploads

    burst = AdaptiveLimit(48, low=4, cooldown=60)
    for _ in range(10):  # many in-flight failures at once count as one cut
        burst.acquire()
    for _ in range(10):
        burst.release(throttled=True)
    assert burst.limit == 24 and burst.throttles == 10


def test_throttled_uploads_are_retried(tmp_path, fixture_paths, monkeypatch):
    import cbb_etl.load_r2 as lr

    monkeypatch.setattr(lr.time, "sleep", lambda s: None)
    store = LocalStore(tmp_path / "out")
    real_put = store.put
    seen: dict[str, int] = {}

    def throttling(key, obj):
        seen[key] = seen.get(key, 0) + 1
        if seen[key] <= 2:  # every object (and shard/manifest write) is throttled twice
            raise lr.Throttled(key)
        real_put(key, obj)

    monkeypatch.setattr(store, "put", throttling)
    b = _build(fixture_paths)
    s = Publisher(store).publish([b], {("mbb", 2026): {"x": "1"}}, {})
    assert s.uploaded == len(b.documents) + 1
    assert (tmp_path / "out" / keys.team_key("mbb", 2026, 1)).exists()
    assert Manifest.load(store).sources["mbb/2026"] == {"x": "1"}
