"""Subagent tool: isolated-context child agent that shares the filesystem and returns only a summary."""

from __future__ import annotations

import json
import os
import time
from typing import Any, Callable, Dict, Optional

from src.agent.context import ContextBuilder
from src.agent.limits import TOOL_RESULT_LIMIT
from src.agent.tools import BaseTool, ToolRegistry

_MAX_SUBAGENT_ITERATIONS = int(os.getenv("SUBAGENT_MAX_ITER", "80"))
_MAX_SUBAGENT_TIMEOUT_SEC = int(os.getenv("SUBAGENT_TIMEOUT", "900"))
_MAX_SUBAGENT_TOKEN_ESTIMATE = 30000

SubagentTraceFn = Callable[[str, Dict[str, Any]], None]


def _tool_result_ok(result: str) -> bool:
    try:
        data = json.loads(result)
        if isinstance(data, dict) and data.get("status") == "error":
            return False
    except (json.JSONDecodeError, TypeError):
        pass
    return '"error"' not in result[:200]


class SubagentTool(BaseTool):
    """Spawn a child agent to execute an independent task with isolated context."""

    name = "subagent"
    is_readonly = False
    description = (
        "Spawn a subagent with fresh context. It shares the filesystem but not "
        "conversation history. Use for parallel research, isolated exploration, "
        "or tasks that would pollute the main context. Returns only a summary."
    )
    parameters = {
        "type": "object",
        "properties": {
            "prompt": {"type": "string", "description": "Task for the subagent"},
            "description": {"type": "string", "description": "Short label for display"},
        },
        "required": ["prompt"],
    }

    def execute(self, **kwargs: Any) -> str:
        """Start a child agent and return its summary.

        Optional ``_subagent_trace`` (injected by AgentLoop): callback ``(event_name, payload)``
        for ``subagent.*`` trace/SSE events mirroring the main loop.

        Args:
            **kwargs: Must include prompt (str). Optional run_dir (str) and description (str).

        Returns:
            JSON string with status and summary fields.
        """
        trace_cb: Optional[SubagentTraceFn] = kwargs.pop("_subagent_trace", None)
        prompt = kwargs["prompt"]
        run_dir = kwargs.get("run_dir")
        description = kwargs.get("description")

        from src.providers.chat import ChatLLM
        from src.tools.backtest_tool import BacktestTool
        from src.tools.bash_tool import BashTool
        from src.tools.edit_file_tool import EditFileTool
        from src.tools.load_skill_tool import LoadSkillTool
        from src.tools.read_file_tool import ReadFileTool
        from src.tools.write_file_tool import WriteFileTool

        llm = ChatLLM()
        child = ToolRegistry()
        for t in [
            BashTool(),
            ReadFileTool(),
            WriteFileTool(),
            EditFileTool(),
            LoadSkillTool(),
            BacktestTool(),
        ]:
            child.register(t)

        messages = [
            {
                "role": "system",
                "content": (
                    "You are a quantitative research subagent. Complete the task using tools, "
                    "then summarize findings."
                ),
            },
            {"role": "user", "content": prompt},
        ]

        if trace_cb:
            trace_cb(
                "subagent.start",
                {
                    "prompt": prompt[:500],
                    **({"description": str(description)[:200]} if description else {}),
                },
            )

        t0 = time.monotonic()
        for iteration in range(_MAX_SUBAGENT_ITERATIONS):
            elapsed = time.monotonic() - t0
            sub_iter = iteration + 1

            if elapsed > _MAX_SUBAGENT_TIMEOUT_SEC:
                payload = {
                    "status": "timeout",
                    "iter": sub_iter,
                    "reason": f"timed out after {elapsed:.0f}s ({iteration} inner rounds)",
                }
                if trace_cb:
                    trace_cb("subagent.end", payload)
                return json.dumps(
                    {
                        "status": "timeout",
                        "summary": f"Subagent timed out after {elapsed:.0f}s ({iteration} iterations)",
                    },
                    ensure_ascii=False,
                )

            token_estimate = len(json.dumps(messages)) // 4
            if token_estimate > _MAX_SUBAGENT_TOKEN_ESTIMATE:
                payload = {
                    "status": "token_limit",
                    "iter": sub_iter,
                    "reason": f"context ~{token_estimate} tokens",
                }
                if trace_cb:
                    trace_cb("subagent.end", payload)
                return json.dumps(
                    {
                        "status": "token_limit",
                        "summary": (
                            f"Subagent context too large (~{token_estimate} tokens, {iteration} iterations)"
                        ),
                    },
                    ensure_ascii=False,
                )

            thinking_chunks: list[str] = []

            def _on_text_chunk(delta: str) -> None:
                thinking_chunks.append(delta)

            response = llm.stream_chat(
                messages,
                tools=child.get_definitions(),
                on_text_chunk=_on_text_chunk,
            )
            thinking_text = "".join(thinking_chunks)
            if thinking_text and trace_cb:
                trace_cb(
                    "subagent.thinking",
                    {"iter": sub_iter, "content": thinking_text[:2000]},
                )

            if not response.has_tool_calls:
                summary = response.content or "(no summary)"
                if trace_cb:
                    trace_cb("subagent.answer", {"iter": sub_iter, "content": summary[:2000]})
                    trace_cb("subagent.end", {"status": "ok", "iter": sub_iter})
                return json.dumps({"status": "ok", "summary": summary}, ensure_ascii=False)

            messages.append(
                ContextBuilder.format_assistant_tool_calls(response.tool_calls, content=response.content)
            )
            for tc in response.tool_calls:
                if trace_cb:
                    trace_cb(
                        "subagent.tool_call",
                        {
                            "iter": sub_iter,
                            "tool": tc.name,
                            "arguments": {k: str(v)[:200] for k, v in tc.arguments.items()},
                        },
                    )
                if run_dir and "run_dir" not in tc.arguments:
                    tc.arguments["run_dir"] = run_dir
                result = child.execute(tc.name, tc.arguments)
                if trace_cb:
                    trace_cb(
                        "subagent.tool_result",
                        {
                            "iter": sub_iter,
                            "tool": tc.name,
                            "status": "ok" if _tool_result_ok(result) else "error",
                            "preview": result[:500],
                        },
                    )
                cap = min(10_000, TOOL_RESULT_LIMIT)
                messages.append(ContextBuilder.format_tool_result(tc.id, tc.name, result[:cap]))

        if trace_cb:
            trace_cb(
                "subagent.end",
                {
                    "status": "iteration_limit",
                    "iter": _MAX_SUBAGENT_ITERATIONS,
                    "reason": f"hit iteration limit ({_MAX_SUBAGENT_ITERATIONS} rounds)",
                },
            )
        return json.dumps(
            {
                "status": "iteration_limit",
                "summary": f"Subagent hit iteration limit ({_MAX_SUBAGENT_ITERATIONS} iterations)",
            },
            ensure_ascii=False,
        )
