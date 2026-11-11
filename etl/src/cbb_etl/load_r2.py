"""Write encoded objects to R2 (S3-compatible API) or a local folder (--dry-run).

Writes are the expensive R2 operation, so every object's content hash is kept in
`v1/manifest.json` and unchanged objects are never re-uploaded. The manifest is written
last, so an interrupted run simply re-uploads on the next attempt.
"""

from __future__ import annotations

import gzip
import json
import re
import shutil
import threading
import time
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol

from . import keys, log
from .config import R2Settings
from .encode import DEFAULT_ENCODER, Encoded, Encoder
from .seasons import current_season

logger = log.get(__name__)


class ObjectStore(Protocol):
    def get(self, key: str) -> bytes | None: ...
    def put(self, key: str, obj: Encoded) -> None: ...
    def put_file(self, key: str, path: Path, content_type: str) -> None: ...
    def delete(self, keys: list[str]) -> None: ...


class LocalStore:
    """Mirrors the R2 layout on disk. Bodies are stored exactly as they would be in R2
    (gzip bytes); a `.meta.json` sidecar keeps the HTTP metadata for seeding wrangler."""

    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str) -> Path:
        return self.root / key

    def get(self, key: str) -> bytes | None:
        p = self._path(key)
        return p.read_bytes() if p.exists() else None

    def put(self, key: str, obj: Encoded) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(obj.body)
        meta = {
            "content_type": obj.content_type,
            "content_encoding": obj.content_encoding,
            "sha256": obj.sha256,
        }
        p.with_name(p.name + ".meta.json").write_text(json.dumps(meta))

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, p)

    def delete(self, keys_: list[str]) -> None:
        for k in keys_:
            p = self._path(k)
            p.unlink(missing_ok=True)
            p.with_name(p.name + ".meta.json").unlink(missing_ok=True)


_RETRYABLE = {"ServiceUnavailable", "SlowDown", "InternalError", "RequestTimeout"}

UPLOAD_CHUNK = 5000  # objects per checkpoint (hash shards saved after each chunk)
UPLOAD_WORKERS = 48  # upper bound; AdaptiveLimit backs off from here when R2 throttles
UPLOAD_MIN_WORKERS = 4
PUT_ATTEMPTS = 8  # per object, with exponential backoff (1s .. 30s) between throttles


class Throttled(Exception):
    """R2 asked us to slow down (503 SlowDown / ServiceUnavailable, etc.)."""


class AdaptiveLimit:
    """Concurrency limit with additive increase / multiplicative decrease.

    Starts at `high`. A throttle halves the limit (not below `low`; at most once per
    `cooldown` seconds, since a burst of in-flight requests tends to fail together);
    every `grow_after` clean uploads raise it by one, back toward `high`. Worker threads
    call acquire/release around each request, so the pool can stay at `high` threads
    while fewer run at once.
    """

    def __init__(self, high: int, low: int = 1, grow_after: int = 50, cooldown: float = 1.0):
        self.high, self.low, self.grow_after = high, max(1, min(low, high)), grow_after
        self.cooldown = cooldown
        self.limit = high
        self.active = 0
        self.throttles = 0
        self._ok = 0
        self._last_cut = float("-inf")
        self._cv = threading.Condition()

    def acquire(self) -> None:
        with self._cv:
            while self.active >= self.limit:
                self._cv.wait()
            self.active += 1

    def release(self, throttled: bool = False) -> None:
        with self._cv:
            self.active -= 1
            if throttled:
                self.throttles += 1
                self._ok = 0
                now = time.monotonic()
                new = max(self.low, self.limit // 2)
                if new < self.limit and now - self._last_cut >= self.cooldown:
                    logger.warning(
                        "r2 throttling; lowering upload concurrency",
                        extra={"from": self.limit, "to": new},
                    )
                    self.limit, self._last_cut = new, now
            else:
                self._ok += 1
                if self._ok >= self.grow_after and self.limit < self.high:
                    self.limit += 1
                    self._ok = 0
            self._cv.notify_all()


class R2Store:
    def __init__(self, settings: R2Settings):
        import boto3
        from botocore.config import Config

        self.bucket = settings.bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.endpoint_url,
            aws_access_key_id=settings.access_key_id,
            aws_secret_access_key=settings.secret_access_key,
            region_name="auto",
            config=Config(
                # botocore retries transient errors a couple of times; sustained throttling
                # surfaces as Throttled so the uploader can lower its concurrency.
                retries={"max_attempts": 3, "mode": "standard"},
                max_pool_connections=UPLOAD_WORKERS + 8,
            ),
        )

    def get(self, key: str) -> bytes | None:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.client.exceptions.NoSuchKey:
            return None

    def put(self, key: str, obj: Encoded) -> None:
        """One PUT (botocore retries transient errors). Raises Throttled when R2 keeps
        asking us to slow down; the caller backs off and lowers concurrency."""
        try:
            self._put_once(key, obj)
        except self.client.exceptions.ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in _RETRYABLE:
                raise Throttled(f"{code} on {key}") from e
            raise

    def _put_once(self, key: str, obj: Encoded) -> None:
        extra: dict[str, Any] = {
            "ContentType": obj.content_type,
            "Metadata": {"sha256": obj.sha256},
        }
        if obj.content_encoding:
            extra["ContentEncoding"] = obj.content_encoding
        self.client.put_object(Bucket=self.bucket, Key=key, Body=obj.body, **extra)

    def put_file(self, key: str, path: Path, content_type: str) -> None:
        # upload_file switches to multipart for large files (pbp is ~90 MB/season)
        self.client.upload_file(
            str(path), self.bucket, key, ExtraArgs={"ContentType": content_type}
        )

    def delete(self, keys_: list[str]) -> None:
        for i in range(0, len(keys_), 1000):
            chunk = keys_[i : i + 1000]
            self.client.delete_objects(
                Bucket=self.bucket, Delete={"Objects": [{"Key": k} for k in chunk]}
            )


# -- manifest -----------------------------------------------------------------------------


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


@dataclass
class Manifest:
    version: int = 1
    encoder: str = DEFAULT_ENCODER.name
    updated_at: str | None = None
    upstream: dict[str, dict[str, str | None]] = field(default_factory=dict)  # sport -> tag ts
    sources: dict[str, dict[str, str]] = field(default_factory=dict)  # "sport/season" -> fps
    seasons: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    objects: dict[str, dict[str, Any]] = field(default_factory=dict)

    @classmethod
    def load(cls, store: ObjectStore) -> Manifest:
        raw = store.get(keys.MANIFEST_KEY)
        if raw is None:
            return cls()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        data = json.loads(raw)
        known = {k: data[k] for k in cls.__dataclass_fields__ if k in data}
        return cls(**known)

    def to_json(self) -> dict[str, Any]:
        return {k: getattr(self, k) for k in self.__dataclass_fields__}


# -- publisher ------------------------------------------------------------------------------

_SEASON_KEY = re.compile(r"^v1/(mbb|wbb)/(\d{4})/")
_CAREER_KEY = re.compile(r"^v1/(mbb|wbb)/players/")


def shard_of(key: str) -> str | None:
    """Hash-shard object for a key, or None if it lives in the main manifest.

    Per-season objects (thousands per season once players exist) and per-player career
    objects are tracked in shard files so the main manifest stays small and a run only
    loads the shards it touches."""
    if m := _SEASON_KEY.match(key):
        return keys.hashes_key(m.group(1), int(m.group(2)))
    if m := _CAREER_KEY.match(key):
        return f"v1/{m.group(1)}/players/_hashes.json"
    return None


@dataclass
class PublishStats:
    uploaded: int = 0
    skipped: int = 0
    deleted: int = 0
    bytes_uploaded: int = 0


class Publisher:
    def __init__(
        self, store: ObjectStore, encoder: Encoder = DEFAULT_ENCODER, dry_run_label: str = "r2"
    ):
        self.store = store
        self.encoder = encoder
        self.label = dry_run_label
        self.manifest = Manifest.load(store)
        self.dirty = False
        self._shards: dict[str, dict[str, str]] = {}  # shard key -> {object key: sha}
        self._dirty_shards: set[str] = set()
        if self.manifest.encoder != encoder.name:
            logger.warning(
                "encoder changed; all objects will be re-uploaded",
                extra={"old": self.manifest.encoder, "new": encoder.name},
            )
            self.manifest.objects = {
                k: v for k, v in self.manifest.objects.items() if "source" in v
            }
            self.manifest.encoder = encoder.name
            self._reset_shards = True
        else:
            self._reset_shards = False

    # -- shards ------------------------------------------------------------------------------
    def _shard(self, shard_key: str) -> dict[str, str]:
        if shard_key not in self._shards:
            shard: dict[str, str] = {}
            raw = None if self._reset_shards else self.store.get(shard_key)
            if raw is not None:
                shard = json.loads(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)
            # one-time migration: season objects used to live in the main manifest
            for k in [k for k in self.manifest.objects if shard_of(k) == shard_key]:
                v = self.manifest.objects.pop(k)
                if "sha256" in v:
                    shard.setdefault(k, v["sha256"][:32])
                self.dirty = True
                self._dirty_shards.add(shard_key)
            self._shards[shard_key] = shard
        return self._shards[shard_key]

    def _known_sha(self, key: str) -> str | None:
        sk = shard_of(key)
        if sk is None:
            v = self.manifest.objects.get(key)
            return v.get("sha256", "")[:32] if v else None
        return self._shard(sk).get(key)

    def _record(self, key: str, enc: Encoded, now: str) -> None:
        sk = shard_of(key)
        if sk is None:
            self.manifest.objects[key] = {
                "sha256": enc.sha256,
                "bytes": len(enc.body),
                "raw_bytes": enc.raw_bytes,
                "updated_at": now,
            }
        else:
            self._shard(sk)[key] = enc.sha256[:32]
            self._dirty_shards.add(sk)

    # -- lake files (main manifest) ------------------------------------------------------
    def file_unchanged(self, key: str, fingerprint: str) -> bool:
        return self.manifest.objects.get(key, {}).get("source") == fingerprint

    def sync_file(
        self,
        key: str,
        path: Path,
        fingerprint: str,
        content_type: str = "application/vnd.apache.parquet",
    ) -> bool:
        """Upload a local file unless the manifest has the same source fingerprint."""
        if self.file_unchanged(key, fingerprint):
            return False
        self.store.put_file(key, path, content_type)
        self.manifest.objects[key] = {
            "source": fingerprint,
            "bytes": path.stat().st_size,
            "updated_at": _now(),
        }
        self.dirty = True
        logger.info("lake upload", extra={"key": key, "bytes": path.stat().st_size})
        return True

    def keys_with_prefix(self, prefix: str) -> list[str]:
        return sorted(k for k in self.manifest.objects if k.startswith(prefix))

    def _put_retrying(self, key: str, obj: Encoded) -> None:
        delay = 1.0
        for attempt in range(PUT_ATTEMPTS):
            try:
                return self.store.put(key, obj)
            except Throttled:
                if attempt == PUT_ATTEMPTS - 1:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 30.0)

    def _save_shards(self) -> None:
        for sk in sorted(self._dirty_shards):
            self._put_retrying(sk, self.encoder.encode(self._shards[sk]))
        self._dirty_shards.clear()

    def save(self) -> None:
        """Write dirty shards, then the main manifest (last)."""
        self._save_shards()
        self.manifest.updated_at = _now()
        self._put_retrying(keys.MANIFEST_KEY, self.encoder.encode(self.manifest.to_json()))
        self.dirty = False

    def season_unchanged(self, sport: str, season: int, fingerprints: dict[str, str]) -> bool:
        return self.manifest.sources.get(f"{sport}/{season}") == fingerprints

    # -- publish -------------------------------------------------------------------------
    def publish(
        self,
        builds: Iterable[Any],
        fingerprints: dict[tuple[str, int], dict[str, str]],
        upstream: dict[str, dict[str, str | None]],
        extra_docs: dict[str, Any] | None = None,
    ) -> PublishStats:
        """Upload changed objects for all builds (+ `extra_docs`, e.g. careers), then
        seasons.json, then the hash shards and the manifest."""
        stats = PublishStats()
        now = _now()
        builds = list(builds)
        pending: list[tuple[str, Encoded]] = []
        stale: list[str] = []

        def consider(key: str, doc: Any) -> None:
            enc = self.encoder.encode(doc)
            if self._known_sha(key) == enc.sha256[:32]:
                stats.skipped += 1
            else:
                pending.append((key, enc))

        for b in builds:
            for key, doc in b.documents.items():
                consider(key, doc)
            shard = self._shard(keys.hashes_key(b.sport, b.season))
            stale += [k for k in shard if k not in b.documents]
        for key, doc in (extra_docs or {}).items():
            consider(key, doc)

        # Upload objects (parallel), then remove stale ones.
        self._upload(pending, now, stats)
        if stale:
            self.store.delete(stale)
            for k in stale:
                sk = shard_of(k)
                if sk:
                    self._shard(sk).pop(k, None)
                    self._dirty_shards.add(sk)
            stats.deleted += len(stale)

        # Season summaries + sources, then seasons.json per sport.
        changed_prefixes = {m.group(0) for k, _ in pending if (m := _SEASON_KEY.match(k))}
        touched_sports = set()
        for b in builds:
            entry = self.manifest.seasons.setdefault(b.sport, {})
            prev = entry.get(str(b.season), {})
            changed = keys.season_prefix(b.sport, b.season) in changed_prefixes
            summary = dict(b.summary)
            summary["updated_at"] = now if changed or not prev else prev.get("updated_at", now)
            entry[str(b.season)] = summary
            self.manifest.sources[f"{b.sport}/{b.season}"] = fingerprints[(b.sport, b.season)]
            touched_sports.add(b.sport)
        seasons_docs = [
            (keys.seasons_key(s), self.encoder.encode(self.seasons_doc(s)))
            for s in sorted(touched_sports)
        ]
        seasons_docs = [(k, e) for k, e in seasons_docs if self._known_sha(k) != e.sha256[:32]]
        self._upload(seasons_docs, now, stats)

        for sport, ts in upstream.items():
            self.manifest.upstream[sport] = ts
        self.save()
        logger.info("publish complete", extra={"target": self.label, **stats.__dict__})
        return stats

    def seasons_doc(self, sport: str) -> dict[str, Any]:
        cur = current_season()
        entries = self.manifest.seasons.get(sport, {})
        seasons = [dict(v, current=(int(k) == cur)) for k, v in entries.items()]
        seasons.sort(key=lambda s: -s["season"])
        return {"sport": sport, "current_season": cur, "seasons": seasons}

    def _upload(self, items: list[tuple[str, Encoded]], now: str, stats: PublishStats) -> None:
        if not items:
            return

        limit = AdaptiveLimit(UPLOAD_WORKERS, UPLOAD_MIN_WORKERS)

        def put(item: tuple[str, Encoded]) -> None:
            delay = 1.0
            for attempt in range(PUT_ATTEMPTS):
                limit.acquire()
                try:
                    self.store.put(*item)
                except Throttled:
                    limit.release(throttled=True)
                    if attempt == PUT_ATTEMPTS - 1:
                        raise
                    time.sleep(delay)
                    delay = min(delay * 2, 30.0)
                    continue
                except BaseException:
                    limit.release()
                    raise
                limit.release()
                return

        # Upload in chunks and checkpoint the hash shards after each one, so a failure
        # mid-backfill doesn't force the next run to re-upload what already landed.
        with ThreadPoolExecutor(max_workers=UPLOAD_WORKERS) as pool:
            for i in range(0, len(items), UPLOAD_CHUNK):
                chunk = items[i : i + UPLOAD_CHUNK]
                t0 = time.monotonic()
                list(pool.map(put, chunk))
                for key, enc in chunk:
                    self._record(key, enc, now)
                    stats.uploaded += 1
                    stats.bytes_uploaded += len(enc.body)
                self._save_shards()
                logger.info(
                    "uploaded batch",
                    extra={
                        "objects": len(chunk),
                        "done": i + len(chunk),
                        "total": len(items),
                        "secs": round(time.monotonic() - t0, 1),
                        "concurrency": limit.limit,
                    },
                )
