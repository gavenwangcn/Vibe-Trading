"""MCP client: stdio and SSE transports — list tools and invoke tools (async)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult

logger = logging.getLogger(__name__)

LIST_TIMEOUT = 90.0
CALL_TIMEOUT = 120.0


def _params_from_cfg(cfg: Dict[str, Any]) -> StdioServerParameters:
    cmd = str(cfg.get("command") or "").strip()
    args = cfg.get("args") or []
    if not isinstance(args, list):
        args = []
    args = [str(x) for x in args]
    env = cfg.get("env") or {}
    if not isinstance(env, dict):
        env = {}
    env_s = {str(k): str(v) for k, v in env.items()}
    return StdioServerParameters(command=cmd, args=args, env=env_s if env_s else None)


def _effective_transport(cfg: Dict[str, Any]) -> str:
    url = str(cfg.get("url") or "").strip()
    cmd = str(cfg.get("command") or "").strip()
    t = str(cfg.get("transport") or "").lower().strip()
    if t == "sse":
        return "sse"
    if url and not cmd:
        return "sse"
    return "stdio"


def _serialize_tool_list(tools_result) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for t in getattr(tools_result, "tools", None) or []:
        item: Dict[str, Any] = {"name": getattr(t, "name", "")}
        desc = getattr(t, "description", None)
        if desc:
            item["description"] = desc
        schema = getattr(t, "inputSchema", None)
        if schema is not None:
            try:
                item["inputSchema"] = schema.model_dump() if hasattr(schema, "model_dump") else schema
            except Exception:
                item["inputSchema"] = {}
        out.append(item)
    return out


def _serialize_call_result(result: CallToolResult) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "isError": bool(getattr(result, "isError", False)),
    }
    contents = getattr(result, "content", None) or []
    blocks: List[Dict[str, Any]] = []
    for c in contents:
        if hasattr(c, "model_dump"):
            blocks.append(c.model_dump())
        elif isinstance(c, dict):
            blocks.append(c)
        else:
            blocks.append({"type": "text", "text": str(c)})
    payload["content"] = blocks
    meta = getattr(result, "meta", None)
    if meta is not None:
        try:
            payload["meta"] = meta.model_dump() if hasattr(meta, "model_dump") else dict(meta)
        except Exception:
            pass
    return payload


async def _with_mcp_session(cfg: Dict[str, Any], fn: Callable[[ClientSession], Any]) -> Any:
    transport = _effective_transport(cfg)
    if transport == "sse":
        from mcp.client.sse import sse_client

        url = str(cfg.get("url") or "").strip()
        if not url:
            raise RuntimeError("SSE transport requires url")
        headers = cfg.get("headers")
        hdr = headers if isinstance(headers, dict) else None
        async with sse_client(url, headers=hdr) as streams:
            read_s, write_s = streams
            async with ClientSession(read_s, write_s) as session:
                await session.initialize()
                return await fn(session)

    params = _params_from_cfg(cfg)
    if not params.command:
        raise RuntimeError("stdio transport requires non-empty command")
    async with stdio_client(params) as streams:
        read_s, write_s = streams
        async with ClientSession(read_s, write_s) as session:
            await session.initialize()
            return await fn(session)


async def list_tools_async(cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    async def _inner(session: ClientSession) -> List[Dict[str, Any]]:
        res = await asyncio.wait_for(session.list_tools(), timeout=LIST_TIMEOUT)
        return _serialize_tool_list(res)

    return await _with_mcp_session(cfg, _inner)


async def call_tool_async(cfg: Dict[str, Any], tool_name: str, arguments: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    async def _inner(session: ClientSession) -> Dict[str, Any]:
        res = await asyncio.wait_for(
            session.call_tool(tool_name, arguments=arguments or {}),
            timeout=CALL_TIMEOUT,
        )
        return _serialize_call_result(res)

    return await _with_mcp_session(cfg, _inner)


def run_coro(coro):
    """Run async coroutine from sync context (Agent tool thread)."""
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    return asyncio.run(coro)


def list_tools_sync(cfg: Dict[str, Any]) -> Tuple[bool, List[Dict[str, Any]], Optional[str]]:
    try:
        tools = run_coro(list_tools_async(cfg))
        return True, tools, None
    except Exception as exc:
        logger.warning("MCP list_tools failed: %s", exc)
        return False, [], str(exc)


def call_tool_sync(cfg: Dict[str, Any], tool_name: str, arguments: Optional[Dict[str, Any]]) -> Tuple[bool, Dict[str, Any], Optional[str]]:
    try:
        data = run_coro(call_tool_async(cfg, tool_name, arguments))
        return True, data, None
    except Exception as exc:
        logger.warning("MCP call_tool failed: %s", exc)
        return False, {}, str(exc)
