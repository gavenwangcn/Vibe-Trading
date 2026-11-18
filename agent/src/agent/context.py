"""ContextBuilder: builds LLM message context for the ReAct AgentLoop."""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Union

from src.agent.memory import WorkspaceMemory
from src.agent.skills import SkillsLoader
from src.agent.tools import ToolRegistry
from src.shanghai_time import now_shanghai
from src.session.content_utils import (
    enrich_user_content_with_recall,
    recall_query_text,
)

if TYPE_CHECKING:
    from src.memory.persistent import PersistentMemory

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = """You are a document and web Q&A agent with {skill_count} skills and {tool_count} tools.
You answer questions from uploaded documents and web pages. Use a configured MCP server when the user asks about an external document collection.

## Tools

{tool_descriptions}

## Skills (use load_skill to read full docs)

{skill_descriptions}

## State

{memory_summary}

## Task Routing

**Document** — the user uploads or points at a file:
1. `load_skill("doc-reader")` when you need the format contract.
2. `read_document(file_path=...)` for PDF, Word, Excel, PowerPoint, images, and text files.

**Web page** — the user gives a URL:
1. `load_skill("web-reader")` when you need the reader contract.
2. `read_url(url=...)` and answer from the returned Markdown.

**Direct question** — the user is not asking you to open a file or page:
- Answer from the conversation. Do not invent document contents.

## Guidelines

- Load the relevant skill before the first document or web read in a session.
- Quote or summarize only what the tool returned. If the tool fails, say so.
- Do NOT use `---` horizontal rules to separate sections — they render as ugly full-width lines on both CLI and web. Use `##` / `###` markdown headings instead.
- All file paths are relative to run_dir (auto-injected).
- Respond in the same language the user used.
- **Time zone:** Whenever you report, query, or generate the current date/time (or interpret "today"), use **Asia/Shanghai** (China Standard Time, UTC+8). Do not use the server's local timezone.
- You have persistent cross-session memory (`remember` tool). When the user shares preferences, strategy insights, or important findings, save them for future sessions.
- For multi-step plans with optional dependencies, use `task_create`, `task_update`, `task_list`, and `task_get` (tasks persist under the agent `.tasks` store).
- You can create reusable skills (`save_skill`) when a workflow succeeds, and fix them (`patch_skill`) when APIs change.
{memory_section}
## Current Date & Time

Today is {current_datetime}.
"""

_MEMORY_SECTION = """
## Persistent Memory (cross-session)

{snapshot}

"""

# Appended to system prompt when session.config["client"] == "wechat".
_WECHAT_CLIENT_APPENDIX = """
## Output channel (WeChat)

The user reads your reply inside WeChat. Rendering differs from a web UI:
- Avoid Markdown tables; for structured data use one field per line like 「字段名：值」.
- Use bullet lines starting with 「·」 or numbered lists 「1. 2. 3.」; separate important points with short paragraphs and blank lines between them.
- Keep formulas simple; prefer plain numbers and short expressions over heavy LaTeX.
- Still match the user's language; stay clear and professional.
"""


class ContextBuilder:
    """Builds message context for AgentLoop.

    Attributes:
        registry: Tool registry.
        memory: Workspace memory.
        skills_loader: Skills loader.
    """

    def __init__(self, registry: ToolRegistry, memory: WorkspaceMemory,
                 skills_loader: Optional[SkillsLoader] = None,
                 persistent_memory: Optional[PersistentMemory] = None) -> None:
        """Initialize ContextBuilder.

        Args:
            registry: Tool registry.
            memory: Workspace memory.
            skills_loader: Skills loader (auto-created if not provided).
            persistent_memory: PersistentMemory instance for cross-session recall.
        """
        self.registry = registry
        self.memory = memory
        self.skills_loader = skills_loader or SkillsLoader()
        self._persistent_memory = persistent_memory

    def build_system_prompt(self, user_message: str = "") -> str:
        """Build system prompt.

        Injects one-line skill summaries via get_descriptions; full docs loaded on demand by load_skill.
        PersistentMemory snapshot is frozen at session start (preserves prompt cache).

        Args:
            user_message: User message (kept for API compatibility).

        Returns:
            System prompt text.
        """
        now = now_shanghai()

        # Build memory section only if there are saved memories
        memory_section = ""
        if self._persistent_memory and self._persistent_memory.snapshot:
            memory_section = _MEMORY_SECTION.format(
                snapshot=self._persistent_memory.snapshot,
            )

        return _SYSTEM_PROMPT.format(
            tool_count=len(self.registry._tools),
            skill_count=len(self.skills_loader.skills),
            tool_descriptions=self._format_tool_descriptions(),
            skill_descriptions=self.skills_loader.get_descriptions(),
            memory_summary=self.memory.to_summary(),
            memory_section=memory_section,
            current_datetime=now.strftime("%A, %B %d, %Y %H:%M (Asia/Shanghai)"),
        )

    def build_messages(
        self,
        user_message: Union[str, List[Dict[str, Any]]],
        history: Optional[List[Dict[str, Any]]] = None,
        session_config: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """Build full message list.

        Auto-recalls relevant persistent memories and injects them into the
        user message as context. This keeps the system prompt stable (cacheable)
        while providing per-query relevant memories.

        Args:
            user_message: Plain string or OpenAI multimodal content parts (text + image_url).
            history: Prior conversation messages.
            session_config: Optional session metadata (e.g. ``{"client": "wechat"}``).

        Returns:
            OpenAI-format message list.
        """
        system_content = self.build_system_prompt(
            recall_query_text(user_message) if isinstance(user_message, list) else user_message,
        )
        if session_config and session_config.get("client") == "wechat":
            system_content = system_content + "\n" + _WECHAT_CLIENT_APPENDIX
        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": system_content},
        ]
        if history:
            messages.extend(history)

        # Auto-recall: inject relevant memories into user message
        enriched: Union[str, List[Dict[str, Any]]] = user_message
        if self._persistent_memory:
            try:
                q = recall_query_text(user_message)
                recalls = self._persistent_memory.find_relevant(q, max_results=3)
                if recalls:
                    lines = [f"- **{r.title}** ({r.memory_type}): {r.body[:500]}" for r in recalls]
                    recall_block = "\n".join(lines)
                    recall_prefix = (
                        f"<recalled-memories>\n{recall_block}\n</recalled-memories>\n\n"
                    )
                    enriched = enrich_user_content_with_recall(user_message, recall_prefix)
            except Exception as exc:
                logger.debug("Auto-recall failed: %s", exc)

        messages.append({"role": "user", "content": enriched})
        return messages

    def _format_tool_descriptions(self) -> str:
        """Format tool descriptions."""
        lines = []
        for tool in self.registry._tools.values():
            params = tool.parameters.get("properties", {})
            required = tool.parameters.get("required", [])
            param_parts = []
            for pname, pschema in params.items():
                req = " (required)" if pname in required else ""
                param_parts.append(f"    - {pname}: {pschema.get('description', pschema.get('type', ''))}{req}")
            param_text = "\n".join(param_parts) if param_parts else "    (no params)"
            lines.append(f"### {tool.name}\n{tool.description}\n  Params:\n{param_text}")
        return "\n\n".join(lines)

    @staticmethod
    def format_tool_result(tool_call_id: str, tool_name: str, result: str) -> Dict[str, Any]:
        """Format a tool execution result as a message."""
        return {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": tool_name,
            "content": result,
        }

    @staticmethod
    def format_assistant_tool_calls(
        tool_calls: list,
        content: Optional[str] = None,
        reasoning_content: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Format an assistant tool_calls message, preserving thinking text.

        Args:
            tool_calls: List of tool call objects.
            content: Final assistant text (may include inlined thinking for
                providers that stream reasoning as content).
            reasoning_content: Provider-specific reasoning field (Kimi K2.5,
                DeepSeek reasoner, Qwen thinking). Only attached to the output
                message when not None, so non-thinking providers see no change.

        Returns:
            OpenAI-format assistant message.
        """
        message = {
            "role": "assistant",
            "content": content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": json.dumps(tc.arguments, ensure_ascii=False),
                    },
                }
                for tc in tool_calls
            ],
        }
        if reasoning_content is not None:
            message["reasoning_content"] = reasoning_content
        return message
