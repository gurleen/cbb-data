"""Season arithmetic. A season is named by its ENDING year (2026 = 2025-26)."""

from __future__ import annotations

from datetime import date


def current_season(today: date | None = None) -> int:
    """Season in progress on `today`: Aug-Dec -> next year, Jan-Jul -> this year."""
    today = today or date.today()
    return today.year + 1 if today.month >= 8 else today.year


def season_label(season: int) -> str:
    """2026 -> '2025-26'."""
    return f"{season - 1}-{season % 100:02d}"


def is_in_season_window(today: date | None = None) -> bool:
    """Upstream refreshes daily from late October to early April."""
    today = today or date.today()
    return today.month in (10, 11, 12, 1, 2, 3, 4)


def parse_seasons(spec: str, first_season: int, today: date | None = None) -> list[int]:
    """Parse --seasons: 'current' | 'all' | '2024,2025' | '2020-2024' (mixable with commas)."""
    cur = current_season(today)
    spec = spec.strip().lower()
    if spec == "current":
        return [cur]
    if spec == "all":
        return list(range(first_season, cur + 1))
    out: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if part == "current":
            out.add(cur)
        elif "-" in part:
            lo, hi = (int(x) for x in part.split("-", 1))
            if lo > hi:
                raise ValueError(f"bad season range: {part}")
            out.update(range(lo, hi + 1))
        else:
            out.add(int(part))
    bad = [s for s in out if s < first_season or s > cur]
    if bad:
        raise ValueError(f"seasons out of range {first_season}-{cur}: {sorted(bad)}")
    if not out:
        raise ValueError("no seasons given")
    return sorted(out)
