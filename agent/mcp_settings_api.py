"""FastAPI routes for MCP server CRUD and connection tests."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Body, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from src.mcp_integration import runtime, store

logger = logging.getLogger(__name__)

router = APIRouter()


class McpServerPublic(BaseModel):
    """Server entry returned to the UI."""

    id: str
    command: str
    args: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    transport: str = "stdio"
    url: Optional[str] = None
    last_error: Optional[str] = None
    tool_count: Optional[int] = None
    tool_names: Optional[List[str]] = None


class McpServerUpsert(BaseModel):
    """stdio needs command; SSE needs url (command may be empty)."""

    id: str = Field(..., min_length=1, max_length=128)
    command: str = ""
    args: List[str] = Field(default_factory=list)
    env: Dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    transport: str = "stdio"
    url: Optional[str] = None

    @field_validator("command", mode="before")
    @classmethod
    def empty_str(cls, v: Any) -> str:
        return "" if v is None else str(v)


def _to_public(sid: str, cfg: Dict[str, Any]) -> McpServerPublic:
    tools = cfg.get("_cached_tools")
    tc = len(tools) if isinstance(tools, list) else None
    names: Optional[List[str]] = None
    if isinstance(tools, list):
        names = []
        for item in tools[:64]:
            if isinstance(item, dict) and item.get("name"):
                names.append(str(item["name"]))
    return McpServerPublic(
        id=sid,
        command=str(cfg.get("command") or ""),
        args=list(cfg.get("args") or []),
        env=dict(cfg.get("env") or {}),
        enabled=bool(cfg.get("enabled", True)),
        transport=str(cfg.get("transport") or "stdio"),
        url=cfg.get("url"),
        last_error=cfg.get("_last_error"),
        tool_count=tc,
        tool_names=names,
    )


@router.get("/servers", response_model=List[McpServerPublic])
async def list_mcp_servers() -> List[McpServerPublic]:
    servers = store.get_servers()
    return [_to_public(sid, c) for sid, c in sorted(servers.items()) if isinstance(c, dict)]


@router.put("/servers/{server_id}", response_model=McpServerPublic)
async def upsert_mcp_server(server_id: str, body: McpServerUpsert) -> McpServerPublic:
    if body.id != server_id:
        raise HTTPException(status_code=400, detail="id in path must match body.id")
    try:
        _, cfg = store.normalize_server_entry(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # Preserve cache fields if updating same structural keys only
    prev = store.get_servers().get(server_id)
    if isinstance(prev, dict):
        for k in ("_cached_tools", "_last_error", "_last_ok_at"):
            if k in prev:
                cfg[k] = prev[k]
    store.set_server(server_id, cfg)
    return _to_public(server_id, store.get_servers()[server_id])


@router.delete("/servers/{server_id}")
async def delete_mcp_server(server_id: str) -> Dict[str, str]:
    if not store.delete_server(server_id):
        raise HTTPException(status_code=404, detail="Server not found")
    return {"status": "ok"}


@router.get("/servers/{server_id}/raw")
async def get_server_raw(server_id: str) -> Dict[str, Any]:
    """Full stored config for one server (includes ``_cached_tools``, ``_last_error``, etc.)."""
    servers = store.get_servers()
    cfg = servers.get(server_id)
    if not isinstance(cfg, dict):
        raise HTTPException(status_code=404, detail="Server not found")
    out: Dict[str, Any] = dict(cfg)
    out["id"] = server_id
    return out


@router.put("/servers/{server_id}/raw", response_model=McpServerPublic)
async def put_server_raw(server_id: str, body: Dict[str, Any] = Body(...)) -> McpServerPublic:
    """Replace server entry with edited JSON. ``id`` in body must match the path if present."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object")
    bid = body.get("id")
    if bid is not None and str(bid) != server_id:
        raise HTTPException(status_code=400, detail="id in JSON must match URL server_id")
    cfg = dict(body)
    cfg.pop("id", None)
    store.set_server(server_id, cfg)
    return _to_public(server_id, store.get_servers()[server_id])


@router.get("/servers/{server_id}/tools")
async def get_server_tools(
    server_id: str,
    refresh: bool = Query(False, description="If true, run list_tools live and update cache"),
) -> Dict[str, Any]:
    """Return tool definitions for one MCP server (from cache or live)."""
    servers = store.get_servers()
    cfg = servers.get(server_id)
    if not isinstance(cfg, dict):
        raise HTTPException(status_code=404, detail="Server not found")
    source = "cache"
    tools: List[Dict[str, Any]] = []
    err: Optional[str] = None
    if refresh:
        ok, live_tools, err = runtime.list_tools_sync(cfg)
        source = "live"
        cfg = dict(cfg)
        if ok:
            cfg["_cached_tools"] = live_tools
            cfg["_last_error"] = None
            cfg["_last_ok_at"] = datetime.now(timezone.utc).isoformat()
        else:
            cfg["_last_error"] = err
        store.set_server(server_id, cfg)
        tools = live_tools if ok else []
    else:
        cached = cfg.get("_cached_tools")
        if isinstance(cached, list):
            tools = [t for t in cached if isinstance(t, dict)]
        else:
            tools = []
    # Normalize for JSON (inputSchema may be nested dicts)
    out: List[Dict[str, Any]] = []
    for t in tools:
        item: Dict[str, Any] = {"name": t.get("name", "")}
        if t.get("description"):
            item["description"] = t["description"]
        if t.get("inputSchema") is not None:
            sch = t["inputSchema"]
            if hasattr(sch, "model_dump"):
                item["inputSchema"] = sch.model_dump()
            else:
                item["inputSchema"] = sch
        out.append(item)
    return {
        "server_id": server_id,
        "tools": out,
        "tool_count": len(out),
        "source": source,
        "error": err,
    }


@router.post("/servers/{server_id}/test")
async def test_mcp_server(server_id: str) -> Dict[str, Any]:
    servers = store.get_servers()
    cfg = servers.get(server_id)
    if not isinstance(cfg, dict):
        raise HTTPException(status_code=404, detail="Server not found")
    ok, tools, err = runtime.list_tools_sync(cfg)
    cfg = dict(cfg)
    if ok:
        cfg["_cached_tools"] = tools
        cfg["_last_error"] = None
        cfg["_last_ok_at"] = datetime.now(timezone.utc).isoformat()
    else:
        cfg["_last_error"] = err
    store.set_server(server_id, cfg)
    return {
        "ok": ok,
        "server_id": server_id,
        "tool_count": len(tools) if ok else 0,
        "tools": tools if ok else [],
        "error": err,
    }


class ImportBody(BaseModel):
    """Raw Cursor-style mcp.json."""

    raw: Dict[str, Any]


@router.post("/import")
async def import_mcp_json(body: ImportBody) -> Dict[str, Any]:
    """Merge Cursor-style { \"mcpServers\": { ... } } into the store."""
    raw = body.raw
    if "mcpServers" in raw:
        incoming = raw["mcpServers"]
    else:
        incoming = raw
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="Invalid JSON shape")
    count = 0
    skipped: List[Dict[str, str]] = []
    for sid, entry in incoming.items():
        if not isinstance(entry, dict):
            skipped.append({"id": str(sid), "reason": "not an object"})
            logger.warning("MCP import skip %s: entry is not a dict", sid)
            continue
        merged = dict(entry)
        merged["id"] = str(sid)
        try:
            _, cfg = store.normalize_server_entry(merged)
        except ValueError as exc:
            skipped.append({"id": str(sid), "reason": str(exc)})
            logger.warning("MCP import skip %s: %s", sid, exc)
            continue
        store.set_server(str(sid), cfg)
        count += 1
        logger.info("MCP import saved server %s transport=%s", sid, cfg.get("transport"))
    return {"status": "ok", "imported": count, "skipped": skipped}
