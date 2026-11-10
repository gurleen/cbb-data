"""Object encoders. Everything written to R2 goes through one `Encoder`, so the wire format
(gzip JSON today) can be swapped for e.g. MessagePack later without touching transforms."""

from __future__ import annotations

import gzip
import hashlib
import json
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class Encoded:
    body: bytes
    content_type: str
    content_encoding: str | None
    sha256: str  # hash of the *uncompressed* canonical payload + encoder name
    raw_bytes: int


class Encoder(Protocol):
    name: str

    def encode(self, obj: Any) -> Encoded: ...


def canonical_json(obj: Any) -> bytes:
    """Deterministic JSON: sorted keys, compact separators, UTF-8."""
    return json.dumps(
        obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def _hash(name: str, raw: bytes) -> str:
    return hashlib.sha256(name.encode() + b"\0" + raw).hexdigest()


class GzipJsonEncoder:
    name = "json+gzip"

    def __init__(self, level: int = 9):
        self.level = level

    def encode(self, obj: Any) -> Encoded:
        raw = canonical_json(obj)
        # mtime=0 keeps gzip output byte-stable for identical input
        body = gzip.compress(raw, compresslevel=self.level, mtime=0)
        return Encoded(body, "application/json", "gzip", _hash(self.name, raw), len(raw))


class MsgpackEncoder:
    """Not used in production yet; here so the swap is a one-line change."""

    name = "msgpack"

    def encode(self, obj: Any) -> Encoded:
        import msgpack  # optional dependency (dev group)

        raw = msgpack.packb(obj, use_bin_type=True)
        return Encoded(raw, "application/msgpack", None, _hash(self.name, raw), len(raw))


DEFAULT_ENCODER: Encoder = GzipJsonEncoder()
