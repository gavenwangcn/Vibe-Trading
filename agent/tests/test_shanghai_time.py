"""Tests for Asia/Shanghai wall-clock helpers."""

from __future__ import annotations

from src.shanghai_time import (
    SHANGHAI_TZ,
    format_epoch_shanghai,
    now_shanghai,
    now_shanghai_iso,
)


def test_now_shanghai_is_aware() -> None:
    dt = now_shanghai()
    assert dt.tzinfo == SHANGHAI_TZ


def test_now_shanghai_iso_has_offset() -> None:
    s = now_shanghai_iso()
    assert "+08:00" in s
    assert "T" in s


def test_format_epoch_shanghai() -> None:
    # 1970-01-01 00:00 UTC = 1970-01-01 08:00 in Shanghai
    out = format_epoch_shanghai(0.0, "%Y-%m-%d %H:%M")
    assert out == "1970-01-01 08:00"
