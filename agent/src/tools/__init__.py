"""Tool registry: v7 atomic tools + domain tools."""

from src.agent.tools import ToolRegistry


def build_registry() -> ToolRegistry:
    """Build static tool registry (built-in tools only — no MCP plugin).

    Used by standalone ``mcp_server`` (Vibe MCP) and lightweight subagents where
    dynamic MCP discovery is not desired.

    Returns:
        ToolRegistry containing built-in tools only.
    """
    from src.tools.bash_tool import BashTool
    from src.tools.read_file_tool import ReadFileTool
    from src.tools.write_file_tool import WriteFileTool
    from src.tools.edit_file_tool import EditFileTool
    from src.tools.load_skill_tool import LoadSkillTool
    from src.tools.backtest_tool import BacktestTool
    from src.tools.pattern_tool import PatternTool
    from src.tools.compact_tool import CompactTool
    from src.tools.subagent_tool import SubagentTool
    from src.tools.task_tools import TaskCreateTool, TaskUpdateTool, TaskListTool, TaskGetTool
    from src.tools.background_tools import BackgroundRunTool, CheckBackgroundTool
    from src.tools.web_reader_tool import WebReaderTool
    from src.tools.web_search_tool import WebSearchTool
    from src.tools.doc_reader_tool import DocReaderTool
    from src.tools.factor_analysis_tool import FactorAnalysisTool
    from src.tools.options_pricing_tool import OptionsPricingTool
    from src.tools.swarm_tool import SwarmTool
    registry = ToolRegistry()
    for tool in [BashTool(), ReadFileTool(), WriteFileTool(),
                 EditFileTool(), LoadSkillTool(), BacktestTool(),
                 PatternTool(), CompactTool(), SubagentTool(),
                 TaskCreateTool(), TaskUpdateTool(), TaskListTool(), TaskGetTool(),
                 BackgroundRunTool(), CheckBackgroundTool(),
                 WebReaderTool(), WebSearchTool(), DocReaderTool(),
                 FactorAnalysisTool(), OptionsPricingTool(), SwarmTool()]:
        registry.register(tool)
    return registry


def build_registry_for_agent() -> ToolRegistry:
    """Build registry for the main web Agent: built-in tools plus MCP dynamic tools.

    On each call, reconnects to enabled MCP servers (or uses cached ``list_tools`` from the
    settings UI test) and registers each remote tool as a first-class function for the LLM
    (same ``tools`` array as native tools).

    Returns:
        ToolRegistry with static + MCP tools.
    """
    from src.tools.mcp_tools import register_mcp_tools

    registry = build_registry()
    register_mcp_tools(registry)
    return registry


def build_filtered_registry(tool_names: list[str]) -> ToolRegistry:
    """Build a filtered registry from the agent pool.

    If the literal name ``mcp`` appears in ``tool_names``, the pool includes dynamically
    discovered MCP tools (``build_registry_for_agent``). Otherwise only built-in tools are
    loaded (faster; no MCP subprocesses).

    When MCP is included, all tools whose function names start with ``mcp_`` are kept if
    ``mcp`` is in ``tool_names``, in addition to exact name matches.

    Args:
        tool_names: Tool names to include.

    Returns:
        Filtered ToolRegistry.
    """
    names = set(tool_names or [])
    include_mcp = "mcp" in names
    full = build_registry_for_agent() if include_mcp else build_registry()
    filtered = ToolRegistry()
    for tname in full.tool_names:
        tool = full.get(tname)
        if not tool:
            continue
        if tname in names:
            filtered.register(tool)
        elif include_mcp and tname.startswith("mcp_"):
            filtered.register(tool)
    return filtered


__all__ = ["build_registry", "build_registry_for_agent", "build_filtered_registry"]
