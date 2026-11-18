#!/usr/bin/env python3
"""Vibe-Trading MCP Server — document and web tools for any MCP client.

Works with OpenClaw, Claude Desktop, Cursor, and any MCP-compatible client.
Tools cover skills, documents, web pages, and local files. Broker and market-data
tools are not part of this server.

Usage:
    python mcp_server.py                    # stdio transport (default)
    python mcp_server.py --transport sse    # SSE transport for web clients

OpenClaw config (~/.openclaw/config.yaml):
    skills:
      - name: vibe-trading
        command: python /path/to/agent/mcp_server.py

Claude Desktop config:
    {
      "mcpServers": {
        "vibe-trading": {
          "command": "python",
          "args": ["/path/to/agent/mcp_server.py"]
        }
      }
    }
"""

from __future__ import annotations

# ruff: noqa: E402

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

# Ensure agent/ is on sys.path
AGENT_DIR = Path(__file__).resolve().parent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from fastmcp import FastMCP

mcp = FastMCP("Vibe-Trading")

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lazy-loaded singletons
# ---------------------------------------------------------------------------

_skills_loader = None
_registry = None
_goal_store = None
_include_shell_tools = True


def _env_shell_tools_enabled() -> bool:
    """Return whether shell tools were explicitly enabled for network MCP."""
    return os.getenv("VIBE_TRADING_ENABLE_SHELL_TOOLS", "").strip().lower() in {"1", "true", "yes", "on"}


def _get_skills_loader():
    global _skills_loader
    if _skills_loader is None:
        from src.agent.skills import SkillsLoader

        _skills_loader = SkillsLoader()
    return _skills_loader


def _get_registry():
    global _registry
    if _registry is None:
        from src.tools import build_registry

        _registry = build_registry(include_shell_tools=_include_shell_tools)
    return _registry


def _get_goal_store():
    """Return the shared finance goal store."""
    global _goal_store
    if _goal_store is None:
        from src.goal import GoalStore

        _goal_store = GoalStore()
    return _goal_store


def _json_ok(**payload: Any) -> str:
    """Return a standard MCP JSON success envelope."""
    return json.dumps({"status": "ok", **payload}, ensure_ascii=False, indent=2)


def _json_error(error: str, *, error_type: str = "error") -> str:
    """Return a standard MCP JSON error envelope."""
    return json.dumps(
        {"status": "error", "error_type": error_type, "error": error},
        ensure_ascii=False,
        indent=2,
    )


def _default_goal_criteria() -> list[str]:
    """Return the MVP finance protocol checklist."""
    from src.goal.context import default_goal_criteria

    return default_goal_criteria()


def _clean_list(value: list[str] | None) -> list[str]:
    """Strip empty list values from MCP payloads."""
    return [item.strip() for item in (value or []) if item and item.strip()]


def _blank_to_none(value: str | None) -> str | None:
    """Normalize blank MCP strings to None."""
    if value is None:
        return None
    value = value.strip()
    return value or None


def _audit_rows_from_payload(value: list[dict[str, Any]] | None):
    """Parse MCP completion audit rows."""
    from src.goal import AuditRow

    rows = []
    for item in value or []:
        criterion_id = str(item.get("criterion_id") or "").strip()
        result = str(item.get("result") or "").strip()
        if not criterion_id or not result:
            raise ValueError("audit rows require criterion_id and result")
        rows.append(
            AuditRow(
                criterion_id=criterion_id,
                result=result,
                evidence_ids=_clean_list(item.get("evidence_ids") or []),
                notes=str(item.get("notes") or ""),
            )
        )
    return rows


def _risk_tier_from_text(value: str):
    """Parse and validate goal risk tier."""
    from src.goal import RiskTier

    risk_tier = RiskTier(value)
    if risk_tier is RiskTier.LIVE_TRADING_OR_EXECUTION:
        raise ValueError("live trading or execution goals are not supported")
    return risk_tier


# ---------------------------------------------------------------------------
# Skill tools
# ---------------------------------------------------------------------------


@mcp.tool
def list_skills() -> str:
    """List all available finance skills with names and descriptions.

    Returns a JSON array of {name, description} for all loaded skills.
    Use load_skill(name) to get the full documentation for any skill.
    """
    loader = _get_skills_loader()
    skills = [{"name": s.name, "description": s.description} for s in loader.skills]
    return json.dumps(skills, ensure_ascii=False, indent=2)


@mcp.tool
def load_skill(name: str) -> str:
    """Load full documentation for a named finance skill.

    Each skill is a comprehensive knowledge document covering methodology,
    code templates, parameters, and examples. Use list_skills() first to
    discover available skills.

    Args:
        name: Skill name (e.g. 'strategy-generate', 'risk-analysis', 'technical-basic').
    """
    loader = _get_skills_loader()
    content = loader.get_content(name)
    if content.startswith("Error:"):
        return json.dumps({"status": "error", "error": content}, ensure_ascii=False)
    return json.dumps({"status": "ok", "skill": name, "content": content}, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Goal tools
# ---------------------------------------------------------------------------


@mcp.tool
def start_research_goal(
    session_id: str,
    objective: str,
    criteria: list[str] | None = None,
    ui_summary: str = "",
    protocol: str = "thesis_review",
    risk_tier: str = "research_general",
    token_budget: int | None = None,
    turn_budget: int | None = None,
    time_budget_seconds: int | None = None,
) -> str:
    """Create or replace the current finance research goal for a session.

    This is the MCP entry point for long-running, research-only finance tasks.
    It creates an auditable goal with checklist criteria and supersedes any
    previous current goal for the same session.

    Args:
        session_id: External conversation/session id owned by the MCP client.
        objective: Research-only objective, not a trade execution request.
        criteria: Optional checklist. Defaults to the MVP finance protocol.
        ui_summary: Optional compact label for UI surfaces.
        protocol: Research protocol name. Defaults to thesis_review.
        risk_tier: One of the supported non-execution risk tiers.
        token_budget: Optional token budget.
        turn_budget: Optional turn budget.
        time_budget_seconds: Optional wall-clock budget.
    """
    try:
        clean_criteria = _clean_list(criteria) or _default_goal_criteria()
        goal = _get_goal_store().replace_goal(
            session_id=session_id.strip(),
            objective=objective,
            criteria=clean_criteria,
            ui_summary=ui_summary,
            source="mcp",
            protocol=protocol,
            risk_tier=_risk_tier_from_text(risk_tier),
            token_budget=token_budget,
            turn_budget=turn_budget,
            time_budget_seconds=time_budget_seconds,
        )
        snapshot = _get_goal_store().get_goal_snapshot(goal.goal_id)
        return _json_ok(snapshot=snapshot)
    except ValueError as exc:
        return _json_error(str(exc), error_type="validation")


@mcp.tool
def get_research_goal(session_id: str) -> str:
    """Return the current finance research goal snapshot for a session.

    Args:
        session_id: External conversation/session id owned by the MCP client.
    """
    try:
        snapshot = _get_goal_store().get_current_snapshot(session_id.strip())
    except ValueError as exc:
        return _json_error(str(exc), error_type="validation")
    if snapshot is None:
        return _json_error("No current goal", error_type="not_found")
    return _json_ok(snapshot=snapshot)


@mcp.tool
def add_goal_evidence(
    session_id: str,
    goal_id: str,
    expected_goal_id: str,
    text: str,
    criterion_id: str | None = None,
    claim_id: str | None = None,
    evidence_type: str = "evidence",
    tool_call_id: str | None = None,
    run_id: str | None = None,
    source_provider: str | None = None,
    source_type: str | None = None,
    source_uri: str | None = None,
    symbol_universe: list[str] | None = None,
    benchmark: list[str] | None = None,
    timeframe: str | None = None,
    method: str | None = None,
    assumptions: dict[str, Any] | None = None,
    artifact_path: str | None = None,
    artifact_hash: str | None = None,
    data_as_of: str | None = None,
    confidence: str | None = None,
    caveat: str | None = None,
    contradicts_claim_ids: list[str] | None = None,
) -> str:
    """Append traceable evidence to a finance research goal.

    Args:
        session_id: External conversation/session id.
        goal_id: Goal being mutated.
        expected_goal_id: Goal id captured before the tool/model turn started.
        text: Evidence note or result summary.
        criterion_id: Optional criterion this evidence satisfies.
        claim_id: Optional claim this evidence supports or contradicts.
        evidence_type: Evidence category, default evidence.
        tool_call_id: Source tool call id for traceability; it does not verify evidence by itself.
        run_id: Vibe-Trading run id. It verifies evidence only when the run directory exists.
        source_provider: Name of the document or web source.
        source_type: Source category such as document or web.
        source_uri: Optional source URL/path.
        symbol_universe: Symbols covered by the evidence.
        benchmark: Benchmark symbols covered by the evidence.
        timeframe: Market timeframe.
        method: Research method used.
        assumptions: Structured assumptions.
        artifact_path: Artifact path. It verifies evidence only when allowed by path policy and paired with a matching sha256 hash.
        artifact_hash: Required sha256 when artifact_path should verify evidence.
        data_as_of: ISO timestamp/date for data freshness.
        confidence: Optional confidence label.
        caveat: Optional limitation note.
        contradicts_claim_ids: Claim ids contradicted by this evidence.
    """
    try:
        from src.goal import EvidenceInput, StaleGoalError

        evidence = _get_goal_store().append_evidence(
            session_id=session_id.strip(),
            goal_id=goal_id.strip(),
            expected_goal_id=expected_goal_id.strip(),
            evidence=EvidenceInput(
                criterion_id=_blank_to_none(criterion_id),
                claim_id=_blank_to_none(claim_id),
                evidence_type=evidence_type,
                text=text,
                tool_call_id=_blank_to_none(tool_call_id),
                run_id=_blank_to_none(run_id),
                source_provider=_blank_to_none(source_provider),
                source_type=_blank_to_none(source_type),
                source_uri=_blank_to_none(source_uri),
                symbol_universe=_clean_list(symbol_universe),
                benchmark=_clean_list(benchmark),
                timeframe=_blank_to_none(timeframe),
                method=_blank_to_none(method),
                assumptions=assumptions or {},
                artifact_path=_blank_to_none(artifact_path),
                artifact_hash=_blank_to_none(artifact_hash),
                data_as_of=_blank_to_none(data_as_of),
                confidence=_blank_to_none(confidence),
                caveat=_blank_to_none(caveat),
                contradicts_claim_ids=_clean_list(contradicts_claim_ids),
            ),
        )
        snapshot = _get_goal_store().get_goal_snapshot(goal_id.strip())
        if snapshot is None:
            return _json_error("Goal snapshot could not be reloaded")
        from dataclasses import asdict

        return _json_ok(evidence=asdict(evidence), snapshot=snapshot)
    except StaleGoalError as exc:
        return _json_error(str(exc), error_type="stale_goal")
    except ValueError as exc:
        return _json_error(str(exc), error_type="validation")


@mcp.tool
def update_research_goal_status(
    session_id: str,
    goal_id: str,
    expected_goal_id: str,
    status: str,
    audit: list[dict[str, Any]] | None = None,
    recap: str | None = None,
) -> str:
    """Update a finance research goal status after an audit.

    Use this to complete, cancel, block, pause, or otherwise move the current
    goal through its lifecycle. ``complete`` requires one audit row per
    required criterion and verified evidence for satisfied rows.

    Args:
        session_id: External conversation/session id.
        goal_id: Goal being mutated.
        expected_goal_id: Goal id captured before the tool/model turn started.
        status: Goal lifecycle status, e.g. complete, cancelled, blocked.
        audit: Optional list of criterion audit rows.
        recap: Optional concise status recap.
    """
    try:
        from src.goal import GoalStatus, StaleGoalError

        updated = _get_goal_store().update_status(
            session_id=session_id.strip(),
            goal_id=goal_id.strip(),
            expected_goal_id=expected_goal_id.strip(),
            status=GoalStatus(status),
            audit=_audit_rows_from_payload(audit),
            recap=_blank_to_none(recap),
        )
        snapshot = _get_goal_store().get_goal_snapshot(updated.goal_id)
        if snapshot is None:
            return _json_error("Goal snapshot could not be reloaded")
        return _json_ok(goal=snapshot["goal"], snapshot=snapshot)
    except StaleGoalError as exc:
        return _json_error(str(exc), error_type="stale_goal")
    except ValueError as exc:
        return _json_error(str(exc), error_type="validation")


# ---------------------------------------------------------------------------
# Backtest tool
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Factor analysis tool
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Options pricing tool
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Pattern recognition tool
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Web & document reading tools
# ---------------------------------------------------------------------------


@mcp.tool
def read_url(url: str) -> str:
    """Fetch a web page and convert it to clean Markdown text.

    Strips ads, navigation, and styling. Useful for reading API docs,
    financial articles, research reports, and GitHub READMEs.

    Args:
        url: Target URL to read.
    """
    from src.tools.web_reader_tool import read_url as _read_url

    return _read_url(url)


@mcp.tool
def read_document(file_path: str) -> str:
    """Extract text from a PDF document with OCR fallback for scanned pages.

    Supports text-based and image-based PDFs. Automatically uses OCR
    for pages with insufficient extractable text.

    Args:
        file_path: Absolute path to the PDF file.
    """
    registry = _get_registry()
    return registry.execute("read_document", {"file_path": file_path})


# ---------------------------------------------------------------------------
# Web search tool
# ---------------------------------------------------------------------------


@mcp.tool
def web_search(query: str, max_results: int = 5) -> str:
    """Search the web via DuckDuckGo and return top results.

    Returns titles, URLs, and snippets. Use read_url() to fetch full content
    from any result URL. Free, no API key required.

    Args:
        query: Search query string.
        max_results: Maximum results to return (default 5, max 10).
    """
    registry = _get_registry()
    return registry.execute(
        "web_search",
        {
            "query": query,
            "max_results": min(max_results, 10),
        },
    )


# ---------------------------------------------------------------------------
# File I/O tools (sandboxed to workspace)
# ---------------------------------------------------------------------------


@mcp.tool
def write_file(path: str, content: str) -> str:
    """Write content to a file inside the workspace sandbox.

    Args:
        path: File path (relative to workspace or absolute).
        content: File content to write.
    """
    registry = _get_registry()
    return registry.execute("write_file", {"path": path, "content": content})


@mcp.tool
def read_file(path: str) -> str:
    """Read the contents of a file.

    Args:
        path: File path to read.
    """
    registry = _get_registry()
    return registry.execute("read_file", {"path": path})


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    """Entry point for `vibe-trading-mcp` CLI command."""
    global _include_shell_tools, _registry
    import argparse

    parser = argparse.ArgumentParser(description="Vibe-Trading MCP Server")
    parser.add_argument("--transport", choices=["stdio", "sse"], default="stdio", help="MCP transport (default: stdio)")
    parser.add_argument("--port", type=int, default=8900, help="SSE port (only used with --transport sse)")
    args = parser.parse_args()
    _include_shell_tools = True if args.transport == "stdio" else _env_shell_tools_enabled()
    _registry = None
    _get_registry()  # pre-warm: avoids deadlock when first tools/call lazy-inits inside FastMCP worker thread

    if args.transport == "sse":
        mcp.run(transport="sse", port=args.port)
    else:
        mcp.run()


if __name__ == "__main__":
    main()
