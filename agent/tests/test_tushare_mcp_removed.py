"""Tushare MCP must not be saved, called, or described to the model."""

from src.agent.context import ContextBuilder
from src.agent.memory import WorkspaceMemory
from src.agent.tools import BaseTool, ToolRegistry
from src.mcp_integration.store import financial_mcp_block_reason, get_servers, set_server


def test_tushare_mcp_is_blocked_by_id_or_url() -> None:
    assert financial_mcp_block_reason("tushareMcp")
    assert financial_mcp_block_reason("docs", "https://api.tushare.pro/mcp/")
    assert financial_mcp_block_reason("feishu-docs", "https://open.feishu.cn/mcp") is None


class _EchoTool(BaseTool):
    def execute(self, **kwargs: object) -> str:
        return "{}"


def test_tushare_tool_is_omitted_from_model_payload(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(
        "src.mcp_integration.store._config_path",
        lambda: tmp_path / "mcp_user_config.json",
    )
    set_server("tushareMcp", {"url": "https://api.tushare.pro/mcp/", "transport": "sse", "enabled": True})
    assert get_servers() == {}
    assert "tushareMcp" not in (tmp_path / "mcp_user_config.json").read_text(encoding="utf-8")

    registry = ToolRegistry()
    kept = _EchoTool()
    kept.name = "read_document"
    kept.description = "Read an uploaded document."
    blocked = _EchoTool()
    blocked.name = "mcp_tushareMcp_daily"
    blocked.description = "[MCP:tushareMcp] daily bars"
    registry.register(kept)
    registry.register(blocked)

    names = [item["function"]["name"] for item in registry.get_definitions()]
    assert names == ["read_document"]
    prompt = ContextBuilder(registry, WorkspaceMemory()).build_system_prompt()
    assert "read_document" in prompt
    assert "tushare" not in prompt.lower()
