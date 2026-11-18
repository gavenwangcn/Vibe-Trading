"""Startup must not import packages that were removed from this agent."""

from __future__ import annotations

import ast
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parents[1]
REMOVED_PREFIXES = (
    "src.factors",
    "src.hypotheses",
    "src.swarm",
    "src.live",
    "src.trading",
    "src.shadow_account",
    "backtest",
)


def _is_removed(module: str | None) -> bool:
    if not module:
        return False
    return any(module == prefix or module.startswith(prefix + ".") for prefix in REMOVED_PREFIXES)


def _removed_imports(path: Path) -> list[tuple[int, str]]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and _is_removed(node.module):
            found.append((node.lineno, f"from {node.module}"))
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if _is_removed(alias.name):
                    found.append((node.lineno, f"import {alias.name}"))
    return found


def test_runtime_modules_do_not_import_removed_packages() -> None:
    """CLI, API, and src must not reference deleted finance packages."""
    roots = [AGENT_DIR / "src", AGENT_DIR / "cli", AGENT_DIR / "api_server.py", AGENT_DIR / "mcp_server.py"]
    problems: list[str] = []
    for root in roots:
        files = [root] if root.is_file() else root.rglob("*.py")
        for path in files:
            if "skills" in path.parts:
                continue
            for lineno, statement in _removed_imports(path):
                problems.append(f"{path.relative_to(AGENT_DIR)}:{lineno} {statement}")
    assert not problems, "startup modules still import removed packages:\n" + "\n".join(problems)


def test_parser_builds_serve_without_removed_imports() -> None:
    """Building the CLI parser is the first step of `vibe-trading serve`."""
    path = AGENT_DIR / "cli" / "_legacy.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    builder = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "_build_parser")
    problems = []
    for node in ast.walk(builder):
        if isinstance(node, ast.ImportFrom) and _is_removed(node.module):
            problems.append(f"from {node.module}")
    assert not problems, problems
    source = ast.get_source_segment(path.read_text(encoding="utf-8"), builder) or ""
    assert 'add_parser("serve"' in source


def test_serve_and_request_logs_are_wired() -> None:
    """Startup and the chat request path emit logs Docker can show."""
    api = (AGENT_DIR / "api_server.py").read_text(encoding="utf-8")
    legacy = (AGENT_DIR / "cli" / "_legacy.py").read_text(encoding="utf-8")
    cli_main = (AGENT_DIR / "cli" / "main.py").read_text(encoding="utf-8")
    session = (AGENT_DIR / "src" / "session" / "service.py").read_text(encoding="utf-8")
    loop = (AGENT_DIR / "src" / "agent" / "loop.py").read_text(encoding="utf-8")
    assert "[serve] starting host=" in api
    assert '"cli"' in api and '"api_server"' in api
    assert "http start" in api
    assert "send_message http session=" in api
    assert "[cli] starting API server" in legacy
    assert "[cli] dispatch argv=" in cli_main
    assert "send_message session=" in session
    assert "llm request done" in loop
