"""Write encoded objects to R2 (S3-compatible API) or a local folder (--dry-run).

Writes are the expensive R2 operation, so every object's content hash is kept in
`v1/manifest.json` and unchanged objects are never re-uploaded. The manifest is written
last, so an interrupted run simply re-uploads on the next attempt.
"""

from __future__ import annotations

import gzip
import json
import shutil
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
            config=Config(retries={"max_attempts": 5, "mode": "standard"}, max_pool_connections=32),
        )

    def get(self, key: str) -> bytes | None:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except self.client.exceptions.NoSuchKey:
            return None

    def put(self, key: str, obj: Encoded) -> None:
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
        if self.manifest.encoder != encoder.name:
            logger.warning(
                "encoder changed; all objects will be re-uploaded",
                extra={"old": self.manifest.encoder, "new": encoder.name},
            )
            self.manifest.objects = {}
            self.manifest.encoder = encoder.name

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

    def save(self) -> None:
        self.manifest.updated_at = _now()
        self.store.put(keys.MANIFEST_KEY, self.encoder.encode(self.manifest.to_json()))
        self.dirty = False

    def season_unchanged(self, sport: str, season: int, fingerprints: dict[str, str]) -> bool:
        return self.manifest.sources.get(f"{sport}/{season}") == fingerprints

    def publish(
        self,
        builds: Iterable[Any],
        fingerprints: dict[tuple[str, int], dict[str, str]],
        upstream: dict[str, dict[str, str | None]],
    ) -> PublishStats:
        """Upload changed objects for all builds, then seasons.json, then the manifest."""
        stats = PublishStats()
        now = _now()
        builds = list(builds)
        pending: list[tuple[str, Encoded]] = []
        stale: list[str] = []

        for b in builds:
            prefix = keys.season_prefix(b.sport, b.season)
            for key, doc in b.documents.items():
                enc = self.encoder.encode(doc)
                prev = self.manifest.objects.get(key)
                if prev and prev.get("sha256") == enc.sha256:
                    stats.skipped += 1
                else:
                    pending.append((key, enc))
            stale += [
                k for k in self.manifest.objects if k.startswith(prefix) and k not in b.documents
            ]

        # Upload season objects (parallel), then remove stale ones.
        self._upload(pending, now, stats)
        if stale:
            self.store.delete(stale)
            for k in stale:
                self.manifest.objects.pop(k, None)
            stats.deleted += len(stale)

        # Season summaries + sources, then seasons.json per sport.
        touched_sports = set()
        for b in builds:
            entry = self.manifest.seasons.setdefault(b.sport, {})
            prev = entry.get(str(b.season), {})
            changed = any(k.startswith(keys.season_prefix(b.sport, b.season)) for k, _ in pending)
            summary = dict(b.summary)
            summary["updated_at"] = now if changed or not prev else prev.get("updated_at", now)
            entry[str(b.season)] = summary
            self.manifest.sources[f"{b.sport}/{b.season}"] = fingerprints[(b.sport, b.season)]
            touched_sports.add(b.sport)
        seasons_docs = [
            (keys.seasons_key(s), self.encoder.encode(self.seasons_doc(s)))
            for s in sorted(touched_sports)
        ]
        seasons_docs = [
            (k, e)
            for k, e in seasons_docs
            if self.manifest.objects.get(k, {}).get("sha256") != e.sha256
        ]
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

        def put(item: tuple[str, Encoded]) -> None:
            self.store.put(*item)

        with ThreadPoolExecutor(max_workers=16) as pool:
            list(pool.map(put, items))
        for key, enc in items:
            self.manifest.objects[key] = {
                "sha256": enc.sha256,
                "bytes": len(enc.body),
                "raw_bytes": enc.raw_bytes,
                "updated_at": now,
            }
            stats.uploaded += 1
            stats.bytes_uploaded += len(enc.body)
