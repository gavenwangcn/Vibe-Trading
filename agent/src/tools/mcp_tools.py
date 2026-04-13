"""MCP plugin: discover remote tools and register them as first-class Agent tools (Function Calling).

Each enabled MCP server contributes tools discovered via list_tools; each becomes a BaseTool whose
name is a sanitized function id (mcp_*) so the LLM receives them in the same ``tools`` array as
built-in tools. Execution routes to call_tool on the originating server.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from src.agent.tools import BaseTool, ToolRegistry
from src.mcp_integration import runtime, store

logger = logging.getLogger(__name__)

_MAX_MCP_TOOLS = int(os.getenv("VIBE_MCP_MAX_TOOLS", "120"))


def _safe_segment(s: str, max_len: int) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", (s or "").strip())
    s = s.strip("_") or "x"
    return s[:max_len]


def _unique_function_name(server_id: str, tool_name: str, used: Set[str]) -> str:
    """Build OpenAI-safe function name (<=64 chars), unique within this registration pass."""
    base = f"mcp_{_safe_segment(server_id, 20)}_{_safe_segment(tool_name, 36)}"
    if len(base) > 64:
        h = hashlib.sha256(f"{server_id}:{tool_name}".encode()).hexdigest()[:12]
        base = f"mcp_{h}_{_safe_segment(tool_name, 44)}"
        base = base[:64]
    name = base
    n = 2
    while name in used:
        suffix = f"_{n}"
        name = (base[: 64 - len(suffix)] + suffix)[:64]
        n += 1
    used.add(name)
    return name


def _normalize_parameters_schema(inp: Any) -> Dict[str, Any]:
    """Ensure JSON-schema shape suitable for OpenAI tools.parameters."""
    if isinstance(inp, dict) and inp.get("type") == "object":
        out = dict(inp)
        out.setdefault("properties", inp.get("properties") or {})
        out.setdefault("required", inp.get("required") or [])
        return out
    if isinstance(inp, dict) and "properties" in inp:
        return {"type": "object", "properties": inp.get("properties") or {}, "required": list(inp.get("required") or [])}
    return {"type": "object", "properties": {}, "required": []}


class McpDelegatedTool(BaseTool):
    """Single MCP tool surfaced as a normal Agent tool."""

    repeatable = True

    def __init__(
        self,
        fn_name: str,
        server_id: str,
        mcp_tool_name: str,
        description: str,
        parameters_schema: Dict[str, Any],
    ) -> None:
        self.name = fn_name
        self._server_id = server_id
        self._mcp_tool_name = mcp_tool_name
        desc = (description or "").strip() or f"MCP tool `{mcp_tool_name}` on server `{server_id}`."
        self.description = f"[MCP:{server_id}] {desc}"
        self.parameters = _normalize_parameters_schema(parameters_schema)

    def execute(self, **kwargs: Any) -> str:
        args = {k: v for k, v in kwargs.items() if k != "run_dir"}
        servers = store.get_servers()
        cfg = servers.get(self._server_id)
        if not isinstance(cfg, dict):
            return json.dumps({"status": "error", "error": f"Unknown MCP server '{self._server_id}'"}, ensure_ascii=False)
        if not cfg.get("enabled", True):
            return json.dumps({"status": "error", "error": f"MCP server '{self._server_id}' is disabled"}, ensure_ascii=False)
        ok, data, err = runtime.call_tool_sync(cfg, self._mcp_tool_name, args)
        if not ok:
            return json.dumps({"status": "error", "error": err or "call failed"}, ensure_ascii=False)
        return json.dumps(
            {"status": "ok", "mcp_server": self._server_id, "mcp_tool": self._mcp_tool_name, "result": data},
            ensure_ascii=False,
            indent=2,
        )


def _load_tools_for_server(server_id: str, cfg: Dict[str, Any]) -> Tuple[bool, List[Dict[str, Any]], Optional[str]]:
    """Return tool dicts from cache or live list_tools."""
    if not cfg.get("enabled", True):
        return True, [], None
    cached = cfg.get("_cached_tools")
    if isinstance(cached, list) and len(cached) > 0:
        return True, cached, None
    ok, tools, err = runtime.list_tools_sync(cfg)
    if ok:
        return True, tools, None
    return False, [], err


def register_mcp_tools(registry: ToolRegistry) -> Dict[str, Any]:
    """Discover tools from all enabled MCP servers and register McpDelegatedTool instances.

    Returns:
        Metadata dict: counts, warnings, per-server stats.
    """
    used_names: Set[str] = set(registry.tool_names)
    servers = store.get_servers()
    meta: Dict[str, Any] = {"servers": [], "registered": 0, "warnings": []}
    total_registered = 0

    for server_id in sorted(servers.keys()):
        cfg = servers.get(server_id)
        if not isinstance(cfg, dict):
            continue
        ok, tool_list, err = _load_tools_for_server(server_id, cfg)
        sinfo: Dict[str, Any] = {"id": server_id, "ok": ok, "count": 0, "error": err}
        if not ok:
            if err:
                meta["warnings"].append(f"{server_id}: {err}")
            meta["servers"].append(sinfo)
            continue
        if not tool_list:
            meta["servers"].append(sinfo)
            continue
        for entry in tool_list:
            if total_registered >= _MAX_MCP_TOOLS:
                meta["warnings"].append(f"Stopped at VIBE_MCP_MAX_TOOLS={_MAX_MCP_TOOLS}")
                break
            if not isinstance(entry, dict):
                continue
            raw_name = str(entry.get("name") or "").strip()
            if not raw_name:
                continue
            desc = str(entry.get("description") or "")
            schema = entry.get("inputSchema") or entry.get("input_schema")
            fn = _unique_function_name(server_id, raw_name, used_names)
            tool = McpDelegatedTool(
                fn_name=fn,
                server_id=server_id,
                mcp_tool_name=raw_name,
                description=desc,
                parameters_schema=schema if isinstance(schema, dict) else {},
            )
            registry.register(tool)
            total_registered += 1
            sinfo["count"] += 1

        meta["servers"].append(sinfo)
        if total_registered >= _MAX_MCP_TOOLS:
            break

    meta["registered"] = total_registered
    logger.info("MCP dynamic tools registered: %s", total_registered)
    return meta
