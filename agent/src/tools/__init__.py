"""Tool registry: auto-discovery via BaseTool.__subclasses__().

Adding a new tool:
  1. Create a file in src/tools/ with a class extending BaseTool
  2. Done. It's automatically discovered and registered.

Tools with missing dependencies can override check_available() → False
to be silently excluded from the registry.
"""

import importlib
import logging
import pkgutil
from collections import deque
from pathlib import Path

from src.agent.tools import BaseTool, ToolRegistry

logger = logging.getLogger(__name__)

_SUBCLASSES_CACHE: list[type[BaseTool]] | None = None


def _discover_subclasses() -> list[type[BaseTool]]:
    """Import all modules in this package, then collect BaseTool subclasses.

    Results are cached after the first call.

    Returns:
        List of concrete BaseTool subclasses with a non-empty name.
    """
    global _SUBCLASSES_CACHE
    if _SUBCLASSES_CACHE is not None:
        return _SUBCLASSES_CACHE

    pkg_dir = str(Path(__file__).parent)
    for _, module_name, _ in pkgutil.iter_modules([pkg_dir]):
        if module_name.startswith("_"):
            continue
        try:
            importlib.import_module(f"src.tools.{module_name}")
        except Exception as exc:
            logger.warning("Skipped src.tools.%s: %s", module_name, exc)

    classes: list[type[BaseTool]] = []
    queue = deque(BaseTool.__subclasses__())
    while queue:
        cls = queue.popleft()
        if cls.name:
            classes.append(cls)
        queue.extend(cls.__subclasses__())

    _SUBCLASSES_CACHE = classes
    return classes


def build_registry(*, persistent_memory: "PersistentMemory | None" = None) -> ToolRegistry:
    """Build the tool registry via auto-discovery, then merge MCP server tools.

    Args:
        persistent_memory: Shared PersistentMemory instance. Injected into
            tools that need it (e.g. RememberTool) so all tools share one
            instance instead of each creating their own.

    Returns:
        ToolRegistry containing built-in tools plus ``mcp_*`` tools from enabled
        servers in ``mcp_user_config.json`` (see MCP settings API).
    """
    from src.tools.remember_tool import RememberTool

    registry = ToolRegistry()
    for cls in _discover_subclasses():
        try:
            if not cls.check_available():
                logger.info("Tool %s unavailable, skipping", cls.name)
                continue
            if cls is RememberTool and persistent_memory is not None:
                registry.register(cls(memory=persistent_memory))
            else:
                registry.register(cls())
        except Exception as exc:
            logger.warning("Failed to register tool %s: %s", cls.name, exc)

    # MCP servers (Cursor-style config): expose list_tools results as normal Agent tools (mcp_*).
    try:
        from src.tools.mcp_tools import register_mcp_tools

        meta = register_mcp_tools(registry)
        for w in meta.get("warnings") or []:
            logger.warning("MCP: %s", w)
        n = int(meta.get("registered") or 0)
        if n:
            logger.info("Registered %s MCP tool(s) for the agent", n)
    except Exception as exc:
        logger.warning("MCP tool registration skipped: %s", exc)

    return registry


def build_filtered_registry(tool_names: list[str]) -> ToolRegistry:
    """Build a ToolRegistry with only specified tools.

    Args:
        tool_names: Tool names to include.

    Returns:
        ToolRegistry containing only the requested tools.
    """
    full = build_registry()
    filtered = ToolRegistry()
    for name in tool_names:
        tool = full.get(name)
        if tool:
            filtered.register(tool)
    return filtered


__all__ = ["build_registry", "build_filtered_registry"]
