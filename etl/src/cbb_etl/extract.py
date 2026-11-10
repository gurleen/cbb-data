"""Download upstream parquet files into a local cache.

DuckDB reads the cached files locally (no httpfs needed). Each cached file carries a
sidecar `.meta.json` with the upstream fingerprint (size + updated_at from the GitHub
releases API, or Content-Length + Last-Modified from a HEAD request when the API is
unavailable). A file is re-downloaded only when its fingerprint changes.
"""

from __future__ import annotations

import json
import shutil
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from . import log
from .config import GITHUB_API, RELEASE_DOWNLOAD_BASE, UPSTREAM_REPO, Dataset, Sport

logger = log.get(__name__)

USER_AGENT = "cbb-etl/0.1 (+https://github.com/sportsdataverse/sportsdataverse-data)"


class AssetNotFound(Exception):
    pass


@dataclass(frozen=True)
class Asset:
    tag: str
    name: str
    size: int | None
    updated_at: str | None

    @property
    def url(self) -> str:
        return f"{RELEASE_DOWNLOAD_BASE}/{self.tag}/{self.name}"

    @property
    def fingerprint(self) -> str:
        return f"{self.size}:{self.updated_at}"


def _request(url: str, method: str = "GET", token: str | None = None, accept: str | None = None):
    headers = {"User-Agent": USER_AGENT}
    if accept:
        headers["Accept"] = accept
    if token and url.startswith(GITHUB_API):
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.Request(url, method=method, headers=headers)


def _open(req, timeout: float = 60, retries: int = 4):
    delay = 2.0
    for attempt in range(retries + 1):
        try:
            return urllib.request.urlopen(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            if e.code in (404, 401, 403) or attempt == retries:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == retries:
                raise
        time.sleep(delay)
        delay *= 2
    raise RuntimeError("unreachable")


class ReleaseClient:
    """Lists release assets (GitHub API, falling back to HEAD probes) and downloads them."""

    def __init__(self, cache_dir: Path, github_token: str | None = None):
        self.cache_dir = cache_dir
        self.token = github_token
        self._listing: dict[str, dict[str, Asset] | None] = {}
        self._api_ok = True  # flips off after the first failure so we don't retry per tag

    # -- listing ---------------------------------------------------------------------------
    def list_assets(self, tag: str) -> dict[str, Asset] | None:
        """All assets for a release tag, or None when the API is unreachable."""
        if tag in self._listing:
            return self._listing[tag]
        if not self._api_ok:
            return None
        assets: dict[str, Asset] | None = {}
        try:
            with _open(
                _request(
                    f"{GITHUB_API}/repos/{UPSTREAM_REPO}/releases/tags/{tag}",
                    token=self.token,
                    accept="application/vnd.github+json",
                )
            ) as r:
                release_id = json.load(r)["id"]
            page = 1
            while True:
                url = (
                    f"{GITHUB_API}/repos/{UPSTREAM_REPO}/releases/{release_id}/assets"
                    f"?per_page=100&page={page}"
                )
                with _open(
                    _request(url, token=self.token, accept="application/vnd.github+json")
                ) as r:
                    batch = json.load(r)
                for a in batch:
                    assets[a["name"]] = Asset(tag, a["name"], a.get("size"), a.get("updated_at"))
                if len(batch) < 100:
                    break
                page += 1
        except (urllib.error.URLError, KeyError, ValueError) as e:
            logger.warning(
                "github api listing unavailable; falling back to HEAD probes",
                extra={"tag": tag, "error": str(e)},
            )
            assets = None
            self._api_ok = False
        self._listing[tag] = assets
        return assets

    def available_seasons(self, sport: Sport, dataset: Dataset) -> list[int] | None:
        """Seasons present for a dataset per the API listing (None if API unavailable)."""
        assets = self.list_assets(dataset.tag(sport))
        if assets is None:
            return None
        prefix = dataset.filename(sport, 0).removesuffix("0.parquet")
        out = []
        for name in assets:
            if name.startswith(prefix) and name.endswith(".parquet"):
                tail = name[len(prefix) : -len(".parquet")]
                if tail.isdigit() and len(tail) == 4:
                    out.append(int(tail))
        return sorted(out)

    def resolve(self, sport: Sport, dataset: Dataset, season: int) -> Asset:
        tag, name = dataset.tag(sport), dataset.filename(sport, season)
        assets = self.list_assets(tag)
        if assets is not None:
            if name not in assets:
                raise AssetNotFound(f"{tag}/{name}")
            return assets[name]
        # Fallback: HEAD the download URL (follows the redirect to the blob store).
        try:
            with _open(_request(f"{RELEASE_DOWNLOAD_BASE}/{tag}/{name}", method="HEAD")) as r:
                size = r.headers.get("Content-Length")
                return Asset(tag, name, int(size) if size else None, r.headers.get("Last-Modified"))
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise AssetNotFound(f"{tag}/{name}") from e
            raise

    # -- downloads -------------------------------------------------------------------------
    def fetch(self, asset: Asset) -> Path:
        """Return a local path for the asset, downloading only if the fingerprint changed."""
        dest = self.cache_dir / asset.tag / asset.name
        meta = dest.with_suffix(dest.suffix + ".meta.json")
        if dest.exists() and meta.exists():
            try:
                if json.loads(meta.read_text()).get("fingerprint") == asset.fingerprint:
                    return dest
            except ValueError:
                pass
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        t0 = time.monotonic()
        with _open(_request(asset.url), timeout=300) as r, open(tmp, "wb") as f:
            shutil.copyfileobj(r, f, length=1 << 20)
        if asset.size is not None and tmp.stat().st_size != asset.size:
            tmp.unlink(missing_ok=True)
            raise OSError(f"size mismatch for {asset.url}")
        tmp.replace(dest)
        meta.write_text(json.dumps({"fingerprint": asset.fingerprint, "url": asset.url}))
        logger.info(
            "downloaded",
            extra={
                "asset": f"{asset.tag}/{asset.name}",
                "bytes": dest.stat().st_size,
                "secs": round(time.monotonic() - t0, 2),
            },
        )
        return dest

    def timestamp(self, tag: str) -> str | None:
        """Upstream refresh time from the release's timestamp.json ('YYYY-MM-DD HH:MM:SS EST')."""
        try:
            with _open(_request(f"{RELEASE_DOWNLOAD_BASE}/{tag}/timestamp.json"), timeout=30) as r:
                return json.load(r).get("last_updated")
        except (urllib.error.URLError, ValueError) as e:
            logger.warning("timestamp.json unavailable", extra={"tag": tag, "error": str(e)})
            return None
