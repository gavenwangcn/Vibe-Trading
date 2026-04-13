"""Persist MCP server definitions (Cursor-compatible mcpServers schema)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Tuple

DEFAULT_CONFIG: Dict[str, Any] = {"version": 1, "mcpServers": {}}


def _config_path() -> Path:
    base = Path(__file__).resolve().parents[2]
    return base / "config" / "mcp_user_config.json"


def load_raw() -> Dict[str, Any]:
    """Load full config object from disk."""
    path = _config_path()
    if not path.exists():
        return json.loads(json.dumps(DEFAULT_CONFIG))
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return json.loads(json.dumps(DEFAULT_CONFIG))
        if "mcpServers" not in data:
            if "servers" in data:
                data = {"version": data.get("version", 1), "mcpServers": data["servers"]}
            else:
                data = {"version": 1, "mcpServers": dict(data)}
        return data
    except (OSError, json.JSONDecodeError):
        return json.loads(json.dumps(DEFAULT_CONFIG))


def save_raw(data: Dict[str, Any]) -> None:
    """Atomically write config to disk."""
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    text = json.dumps(data, ensure_ascii=False, indent=2)
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def get_servers() -> Dict[str, Any]:
    """Return mcpServers map: server_id -> config dict."""
    raw = load_raw()
    servers = raw.get("mcpServers") or {}
    if not isinstance(servers, dict):
        return {}
    return servers


def set_server(server_id: str, cfg: Dict[str, Any]) -> None:
    """Insert or replace one server entry."""
    raw = load_raw()
    m = dict(raw.get("mcpServers") or {})
    m[server_id] = cfg
    raw["mcpServers"] = m
    save_raw(raw)


def delete_server(server_id: str) -> bool:
    """Remove a server. Returns True if it existed."""
    raw = load_raw()
    m = dict(raw.get("mcpServers") or {})
    if server_id not in m:
        return False
    del m[server_id]
    raw["mcpServers"] = m
    save_raw(raw)
    return True


def normalize_server_entry(entry: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
    """Normalize user/Cursor payload to internal shape. Returns (id, cfg).

    Supports:
    - **stdio**: ``command`` (+ optional ``args``, ``env``) — local subprocess.
    - **SSE**: ``url`` only (or ``transport: sse``) — remote HTTP SSE endpoint (e.g. ``.../sse``).
    """
    sid = str(entry.get("id") or entry.get("name") or "").strip()
    if not sid:
        raise ValueError("server id is required")
    args = entry.get("args")
    if args is None:
        args = []
    if isinstance(args, str):
        import shlex

        args = shlex.split(args)
    if not isinstance(args, list):
        args = []
    args = [str(a) for a in args]
    env = entry.get("env") or {}
    if not isinstance(env, dict):
        env = {}
    env_out = {str(k): str(v) for k, v in env.items()}
    enabled = bool(entry.get("enabled", True))
    url_raw = entry.get("url")
    url = str(url_raw).strip() if url_raw not in (None, "") else None
    command = str(entry.get("command") or "").strip()
    transport_in = str(entry.get("transport") or "").lower().strip()

    # SSE: URL-only configs (Cursor / Claude Desktop style: only "url")
    if url and not command:
        return sid, {
            "command": "",
            "args": [],
            "env": env_out,
            "enabled": enabled,
            "transport": "sse",
            "url": url,
        }

    if not command:
        raise ValueError("provide command (stdio) or url (SSE), not neither")

    transport = transport_in if transport_in in ("stdio", "sse") else "stdio"
    if transport == "sse":
        if not url:
            raise ValueError("transport sse requires url")
        return sid, {
            "command": command,
            "args": args,
            "env": env_out,
            "enabled": enabled,
            "transport": "sse",
            "url": url,
        }

    out: Dict[str, Any] = {
        "command": command,
        "args": args,
        "env": env_out,
        "enabled": enabled,
        "transport": "stdio",
    }
    if url:
        out["url"] = url
    return sid, out
