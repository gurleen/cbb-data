from datetime import date

import pytest

from cbb_etl.seasons import current_season, is_in_season_window, parse_seasons, season_label


@pytest.mark.parametrize(
    "d, expected",
    [
        (date(2026, 1, 1), 2026),
        (date(2026, 7, 31), 2026),
        (date(2026, 8, 1), 2027),
        (date(2026, 11, 10), 2027),
        (date(2026, 12, 31), 2027),
    ],
)
def test_current_season(d, expected):
    assert current_season(d) == expected


def test_label():
    assert season_label(2026) == "2025-26"
    assert season_label(2000) == "1999-00"


def test_window():
    assert is_in_season_window(date(2026, 10, 1))
    assert is_in_season_window(date(2027, 4, 30))
    assert not is_in_season_window(date(2026, 6, 15))


TODAY = date(2026, 11, 10)


def test_parse_current_and_all():
    assert parse_seasons("current", 2003, TODAY) == [2027]
    seasons = parse_seasons("all", 2003, TODAY)
    assert seasons[0] == 2003 and seasons[-1] == 2027 and len(seasons) == 25


def test_parse_lists_and_ranges():
    assert parse_seasons("2025,2024", 2003, TODAY) == [2024, 2025]
    assert parse_seasons("2020-2022,current", 2003, TODAY) == [2020, 2021, 2022, 2027]
    assert parse_seasons(" 2024 , 2024 ", 2003, TODAY) == [2024]


@pytest.mark.parametrize("spec", ["2002", "2028", "2025-2020", "", "abc"])
def test_parse_rejects(spec):
    with pytest.raises(ValueError):
        parse_seasons(spec, 2003, TODAY)
