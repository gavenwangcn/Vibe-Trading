"""MCP client: stdio and SSE transports — list tools and invoke tools (async)."""

from __future__ import annotations

import asyncio
import atexit
import concurrent.futures
import logging
import os
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.types import CallToolResult

logger = logging.getLogger(__name__)

LIST_TIMEOUT = float(os.getenv("MCP_LIST_TIMEOUT", "90"))
# Single MCP tools/call_tool wait (stdio or SSE)
CALL_TIMEOUT = float(os.getenv("MCP_CALL_TIMEOUT", "360"))
# Extra seconds for thread-bridge overhead (spawn stdio / SSE handshake)
BRIDGE_TIMEOUT = float(os.getenv("MCP_BRIDGE_TIMEOUT", str(LIST_TIMEOUT + 30)))
_MCP_VERBOSE = os.getenv("VIBE_MCP_VERBOSE", "").strip().lower() in ("1", "true", "yes")


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


def _cfg_label(cfg: Dict[str, Any], server_id: str = "") -> str:
    """Short, non-secret description for logs."""
    sid = (server_id or "").strip() or "?"
    transport = _effective_transport(cfg)
    if transport == "sse":
        return f"{sid} transport=sse url={cfg.get('url') or ''}"
    cmd = str(cfg.get("command") or "").strip()
    args = cfg.get("args") or []
    if isinstance(args, list):
        arg_s = " ".join(str(a) for a in args[:6])
    else:
        arg_s = ""
    return f"{sid} transport=stdio command={cmd} {arg_s}".strip()


def _log_failure(context: str, label: str, exc: BaseException, elapsed: float) -> None:
    """Log MCP errors, expanding ExceptionGroup / TaskGroup sub-exceptions."""
    logger.warning(
        "MCP %s failed [%s] elapsed=%.2fs: %s",
        context,
        label,
        elapsed,
        exc,
    )
    subs = getattr(exc, "exceptions", None)
    if subs:
        for i, sub in enumerate(subs):
            logger.warning("MCP %s sub-error[%d] [%s]: %s", context, i, label, sub)
            if _MCP_VERBOSE:
                logger.debug("MCP %s sub-error[%d] traceback", context, i, exc_info=sub)
    elif _MCP_VERBOSE:
        logger.debug("MCP %s traceback [%s]", context, label, exc_info=exc)


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


async def _with_mcp_session(
    cfg: Dict[str, Any],
    fn: Callable[[ClientSession], Any],
    *,
    server_id: str = "",
) -> Any:
    transport = _effective_transport(cfg)
    label = _cfg_label(cfg, server_id)
    if _MCP_VERBOSE:
        logger.info("MCP session open [%s]", label)
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


async def list_tools_async(cfg: Dict[str, Any], *, server_id: str = "") -> List[Dict[str, Any]]:
    async def _inner(session: ClientSession) -> List[Dict[str, Any]]:
        res = await asyncio.wait_for(session.list_tools(), timeout=LIST_TIMEOUT)
        return _serialize_tool_list(res)

    return await _with_mcp_session(cfg, _inner, server_id=server_id)


async def call_tool_async(cfg: Dict[str, Any], tool_name: str, arguments: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    async def _inner(session: ClientSession) -> Dict[str, Any]:
        res = await asyncio.wait_for(
            session.call_tool(tool_name, arguments=arguments or {}),
            timeout=CALL_TIMEOUT,
        )
        return _serialize_call_result(res)

    return await _with_mcp_session(cfg, _inner)


_mcp_bridge_pool: Optional[concurrent.futures.ThreadPoolExecutor] = None


def _mcp_bridge_executor() -> concurrent.futures.ThreadPoolExecutor:
    global _mcp_bridge_pool
    if _mcp_bridge_pool is None:
        _mcp_bridge_pool = concurrent.futures.ThreadPoolExecutor(
            max_workers=8,
            thread_name_prefix="mcp_asyncio_bridge",
        )

        def _shutdown() -> None:
            if _mcp_bridge_pool is not None:
                _mcp_bridge_pool.shutdown(wait=False, cancel_futures=True)

        atexit.register(_shutdown)
    return _mcp_bridge_pool


def run_coro(coro):
    """Run async coroutine from sync code.

    Uses ``asyncio.run`` when no loop is running (CLI, worker threads). When a loop is already
    running (e.g. FastAPI request handler calling sync MCP helpers), runs the coroutine in a
    dedicated thread with its own loop — ``asyncio.run()`` cannot nest on the same thread.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    fut = _mcp_bridge_executor().submit(asyncio.run, coro)
    return fut.result(timeout=BRIDGE_TIMEOUT)


def list_tools_sync(
    cfg: Dict[str, Any],
    server_id: str = "",
) -> Tuple[bool, List[Dict[str, Any]], Optional[str]]:
    label = _cfg_label(cfg, server_id)
    t0 = time.perf_counter()
    logger.info("MCP list_tools start [%s] timeout=%.0fs", label, LIST_TIMEOUT)
    try:
        tools = run_coro(list_tools_async(cfg, server_id=server_id))
        elapsed = time.perf_counter() - t0
        logger.info("MCP list_tools ok [%s] tools=%d elapsed=%.2fs", label, len(tools), elapsed)
        return True, tools, None
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        _log_failure("list_tools", label, exc, elapsed)
        return False, [], str(exc)


def call_tool_sync(
    cfg: Dict[str, Any],
    tool_name: str,
    arguments: Optional[Dict[str, Any]],
    server_id: str = "",
) -> Tuple[bool, Dict[str, Any], Optional[str]]:
    label = f"{_cfg_label(cfg, server_id)} tool={tool_name}"
    t0 = time.perf_counter()
    logger.info("MCP call_tool start [%s] timeout=%.0fs", label, CALL_TIMEOUT)
    try:
        data = run_coro(call_tool_async(cfg, tool_name, arguments))
        elapsed = time.perf_counter() - t0
        logger.info("MCP call_tool ok [%s] elapsed=%.2fs", label, elapsed)
        return True, data, None
    except Exception as exc:
        elapsed = time.perf_counter() - t0
        _log_failure("call_tool", label, exc, elapsed)
        return False, {}, str(exc)
