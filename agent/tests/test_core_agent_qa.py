"""Core document/web Q&A agent still answers after finance surfaces are removed."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from src.agent.context import ContextBuilder
from src.agent.loop import AgentLoop
from src.agent.memory import WorkspaceMemory
from src.agent.skills import SkillsLoader
from src.providers.chat import LLMResponse, ToolCallRequest
from src.tools import build_registry
from src.tools.doc_reader_tool import DocReaderTool

pytestmark = pytest.mark.unit

_BROKER_TOOLS = {
    "trading_account",
    "trading_positions",
    "trading_orders",
    "trading_quote",
    "trading_place_order",
    "run_swarm",
}


class _ScriptedLLM:
    """Returns a queued response per stream_chat call."""

    def __init__(self, responses: list[LLMResponse]) -> None:
        self._responses = list(responses)
        self.calls = 0

    def stream_chat(self, messages, tools=None, on_text_chunk=None):  # noqa: ANN001
        self.calls += 1
        if on_text_chunk and self._responses:
            text = self._responses[0].content or ""
            if text and not self._responses[0].tool_calls:
                on_text_chunk(text)
        if not self._responses:
            return LLMResponse(content="")
        return self._responses.pop(0)


def test_bundled_skills_are_document_and_web_only(tmp_path: Path) -> None:
    skills_dir = Path(__file__).resolve().parents[1] / "src" / "skills"
    loader = SkillsLoader(skills_dir=skills_dir, user_skills_dir=tmp_path / "user-skills")
    names = {skill.name for skill in loader.skills}
    assert names == {"doc-reader", "web-reader"}


def test_registry_keeps_core_tools() -> None:
    names = set(build_registry(include_shell_tools=False).tool_names)
    assert {"read_document", "read_url", "load_skill", "remember", "start_research_goal"} <= names
    assert names.isdisjoint(_BROKER_TOOLS)


def test_system_prompt_keeps_skills_and_memory() -> None:
    registry = build_registry(include_shell_tools=False)
    prompt = ContextBuilder(registry, WorkspaceMemory()).build_system_prompt()
    assert "load_skill" in prompt
    assert "remember" in prompt
    assert "read_document" in prompt or "read_url" in prompt


def test_agent_answers_a_plain_question(tmp_path: Path) -> None:
    registry = build_registry(include_shell_tools=False)
    llm = _ScriptedLLM([LLMResponse(content="你好，我可以阅读文档和网页。")])
    memory = WorkspaceMemory(run_dir=str(tmp_path))
    result = AgentLoop(registry, llm, memory=memory, max_iterations=3).run("你好")

    assert result["status"] == "success"
    assert result["content"] == "你好，我可以阅读文档和网页。"
    assert llm.calls == 1
    assert not any(step.get("type") == "tool_call" for step in result["react_trace"])


def test_agent_reads_a_document_then_answers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    document = uploads / "note.txt"
    document.write_text("飞书对接前的示例：问答只依据文档。", encoding="utf-8")
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(uploads))

    registry = build_registry(include_shell_tools=False)
    llm = _ScriptedLLM(
        [
            LLMResponse(
                content="",
                tool_calls=[
                    ToolCallRequest(
                        id="call-1",
                        name="read_document",
                        arguments={"file_path": str(document)},
                    )
                ],
            ),
            LLMResponse(content="文档说：问答只依据文档。"),
        ]
    )
    result = AgentLoop(
        registry,
        llm,
        memory=WorkspaceMemory(run_dir=str(tmp_path / "run")),
        max_iterations=4,
    ).run("这份文档在说什么？")

    assert result["status"] == "success"
    assert "问答只依据文档" in result["content"]
    tool_steps = [step for step in result["react_trace"] if step.get("type") == "tool_call"]
    assert tool_steps and tool_steps[0]["tool"] == "read_document"
    assert "问答只依据文档" in tool_steps[0]["result_preview"]
    assert llm.calls == 2


def test_read_document_tool_returns_text(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    document = uploads / "note.txt"
    document.write_text("hello document", encoding="utf-8")
    monkeypatch.setenv("VIBE_TRADING_ALLOWED_FILE_ROOTS", str(uploads))

    payload = json.loads(DocReaderTool().execute(file_path=str(document)))
    assert payload["status"] == "ok"
    assert "hello document" in payload["text"]
