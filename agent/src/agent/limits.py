"""Shared numeric limits for agent message and tool payloads."""

import os

from src.providers.llm import _ensure_dotenv

_ensure_dotenv()

# Max characters of each tool result string passed to the LLM (see AgentLoop / Subagent / Swarm).
# Unset or empty `TOOL_RESULT_LIMIT` in .env → use this default (30000).
_DEFAULT_TOOL_RESULT_LIMIT = 30_000
# Missing, empty, or whitespace-only → 30000 (getenv default alone does not treat empty value as unset).
_parsed = (os.getenv("TOOL_RESULT_LIMIT") or str(_DEFAULT_TOOL_RESULT_LIMIT)).strip()
TOOL_RESULT_LIMIT = max(1, int(_parsed))

# Trace / SSE preview: first + last chunk, middle replaced (not only a prefix).
TRACE_PREVIEW_HEAD = 500
TRACE_PREVIEW_TAIL = 500
TRACE_PREVIEW_GAP = "....."


def trace_result_preview(result: str) -> str:
    """Shorten tool result for trace and UI: head + gap + tail when longer than head+tail."""
    if not isinstance(result, str):
        result = str(result)
    max_plain = TRACE_PREVIEW_HEAD + TRACE_PREVIEW_TAIL
    if len(result) <= max_plain:
        return result
    return (
        result[:TRACE_PREVIEW_HEAD]
        + TRACE_PREVIEW_GAP
        + result[-TRACE_PREVIEW_TAIL:]
    )
