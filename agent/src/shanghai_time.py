"""User-facing wall-clock times use Asia/Shanghai regardless of server host TZ."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

# China Standard Time (no DST). Fixed UTC+8 avoids an extra ``tzdata`` dependency on Windows
# where ``ZoneInfo("Asia/Shanghai")`` may be unavailable.
SHANGHAI_TZ = timezone(timedelta(hours=8))


def now_shanghai() -> datetime:
    """Current time in Asia/Shanghai (timezone-aware)."""
    return datetime.now(SHANGHAI_TZ)


def now_shanghai_iso() -> str:
    """ISO-8601 string with offset, e.g. 2026-04-17T14:30:00+08:00."""
    return now_shanghai().isoformat(timespec="seconds")


def format_epoch_shanghai(epoch: float, fmt: str = "%Y-%m-%d %H:%M") -> str:
    """Format a Unix epoch (seconds) for display in Shanghai."""
    return datetime.fromtimestamp(epoch, tz=SHANGHAI_TZ).strftime(fmt)


def format_epoch_shanghai_hms(epoch: float) -> str:
    """Format epoch as HH:MM:SS in Shanghai."""
    return datetime.fromtimestamp(epoch, tz=SHANGHAI_TZ).strftime("%H:%M:%S")
