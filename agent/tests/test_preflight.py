"""Tests for startup preflight checks."""

from __future__ import annotations

from src import preflight


def test_preflight_does_not_probe_market_data_sources() -> None:
    """Startup must not import or call market-data libraries."""
    for name in ("_check_akshare", "_check_tushare", "_check_yfinance", "_check_okx", "_check_ccxt"):
        assert not hasattr(preflight, name)
