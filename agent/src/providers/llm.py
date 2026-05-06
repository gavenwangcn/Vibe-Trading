"""LLM factory and JSON extraction helpers."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, Optional

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore

try:
    from langchain_openai import ChatOpenAI
except ImportError:
    ChatOpenAI = None  # type: ignore


if ChatOpenAI is not None:
    class ChatOpenAIWithReasoning(ChatOpenAI):  # type: ignore[misc,valid-type]
        """ChatOpenAI that preserves provider reasoning across invoke + stream.

        langchain-openai 0.3.x drops non-standard fields in three paths:
          * _convert_dict_to_message — invoke / ainvoke (inbound)
          * _convert_delta_to_message_chunk — stream / astream (inbound)
          * _convert_message_to_dict — request serialization (outbound)
        Moonshot/DeepSeek emit `reasoning_content`; OpenRouter relays as
        `reasoning`. Inbound paths normalize to additional_kwargs["reasoning_content"];
        outbound path re-injects it so strict providers (kimi-k2.5) accept
        multi-turn continuations.
        """

        @staticmethod
        def _capture(src: Any, msg: Any) -> None:
            if value := src.get("reasoning_content") or src.get("reasoning"):
                msg.additional_kwargs["reasoning_content"] = value

        def _create_chat_result(self, response, generation_info=None):  # type: ignore[override]
            result = super()._create_chat_result(response, generation_info)
            raw = response if isinstance(response, dict) else response.model_dump()
            for gen, choice in zip(result.generations, raw["choices"]):
                self._capture(choice["message"], gen.message)
            return result

        def _convert_chunk_to_generation_chunk(  # type: ignore[override]
            self,
            chunk: dict,
            default_chunk_class: type,
            base_generation_info: Optional[dict],
        ):
            gen = super()._convert_chunk_to_generation_chunk(
                chunk, default_chunk_class, base_generation_info
            )
            if gen is None:
                return None
            choices = chunk.get("choices") or chunk.get("chunk", {}).get("choices")
            if choices:
                self._capture(choices[0]["delta"], gen.message)
            return gen

        def _get_request_payload(  # type: ignore[override]
            self,
            input_: Any,
            *,
            stop: Optional[list[str]] = None,
            **kwargs: Any,
        ) -> dict:
            """Re-inject reasoning_content and normalize assistant content.

            LangChain strips ``reasoning_content`` when serializing AIMessages
            back to OpenAI wire format. Moonshot kimi-k2.5 also rejects
            assistant turns where ``content`` is null or ``reasoning_content``
            is absent, breaking ReAct continuations after a tool call (#39).
            """
            payload = super()._get_request_payload(input_, stop=stop, **kwargs)
            messages = super()._convert_input(input_).to_messages()
            for i, m in enumerate(payload["messages"]):
                if m.get("role") != "assistant":
                    continue
                if m.get("content") is None:
                    m["content"] = ""
                m["reasoning_content"] = messages[i].additional_kwargs.get("reasoning_content", "")
            return payload
else:
    ChatOpenAIWithReasoning = None  # type: ignore

AGENT_DIR = Path(__file__).resolve().parents[2]

# .env search order: ~/.vibe-trading/.env → agent/.env → $CWD/.env
_ENV_CANDIDATES = [
    Path.home() / ".vibe-trading" / ".env",
    AGENT_DIR / ".env",
    Path.cwd() / ".env",
]

_dotenv_loaded: bool = False


def _load_env_file(path: Path) -> None:
    """Load a single .env file into os.environ (setdefault, no override)."""
    if load_dotenv is not None:
        load_dotenv(dotenv_path=path, override=False)
    else:
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if key:
                os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def _ensure_dotenv() -> None:
    """Load `.env` from the first found candidate path."""
    global _dotenv_loaded
    if _dotenv_loaded:
        return
    for candidate in _ENV_CANDIDATES:
        if candidate.exists():
            _load_env_file(candidate)
            break
    _dotenv_loaded = True


def _sync_provider_env(provider: Optional[str] = None) -> None:
    """Map provider-specific env vars to OPENAI_* for ChatOpenAI.

    Each entry: provider_name -> (api_key_env, base_url_env).
    All base URLs must be set explicitly in .env — no hardcoded defaults.
    api_key_env=None means no key required (e.g. Ollama local).

    Args:
        provider: Provider id (e.g. ``openai``, ``deepseek``). If None, uses ``LANGCHAIN_PROVIDER``.
    """
    _ensure_dotenv()
    p = provider if provider is not None else os.getenv("LANGCHAIN_PROVIDER", "openai")
    provider = p.lower().strip()

    if provider in {"openai-codex", "openai_codex"}:
        codex_url = os.getenv("OPENAI_CODEX_BASE_URL", "https://chatgpt.com/backend-api/codex/responses")
        os.environ["OPENAI_API_BASE"] = codex_url
        os.environ["OPENAI_BASE_URL"] = codex_url
        os.environ.pop("OPENAI_API_KEY", None)
        return

    # (api_key_env, base_url_env)
    _PROVIDER_MAP: dict[str, tuple[str | None, str]] = {
        "openai":     ("OPENAI_API_KEY",     "OPENAI_BASE_URL"),
        "openrouter": ("OPENROUTER_API_KEY",  "OPENROUTER_BASE_URL"),
        "deepseek":   ("DEEPSEEK_API_KEY",    "DEEPSEEK_BASE_URL"),
        "gemini":     ("GEMINI_API_KEY",      "GEMINI_BASE_URL"),
        "groq":       ("GROQ_API_KEY",        "GROQ_BASE_URL"),
        "dashscope":  ("DASHSCOPE_API_KEY",   "DASHSCOPE_BASE_URL"),
        "qwen":       ("DASHSCOPE_API_KEY",   "DASHSCOPE_BASE_URL"),
        "zhipu":      ("ZHIPU_API_KEY",       "ZHIPU_BASE_URL"),
        "moonshot":   ("MOONSHOT_API_KEY",    "MOONSHOT_BASE_URL"),
        "minimax":    ("MINIMAX_API_KEY",     "MINIMAX_BASE_URL"),
        "mimo":       ("MIMO_API_KEY",        "MIMO_BASE_URL"),
        "zai":        ("ZAI_API_KEY",         "ZAI_BASE_URL"),
        "ollama":     (None,                  "OLLAMA_BASE_URL"),
    }

    spec = _PROVIDER_MAP.get(provider, _PROVIDER_MAP["openai"])
    key_env, base_env = spec

    # Resolve API key: provider-specific env → OPENAI_API_KEY fallback
    if key_env is not None:
        api_key = os.getenv(key_env, "") or os.getenv("OPENAI_API_KEY", "")
    else:
        api_key = os.getenv("OPENAI_API_KEY", "") or "ollama"

    # Resolve base URL: provider-specific env → OPENAI_BASE_URL fallback
    base_url = os.getenv(base_env, "") or os.getenv("OPENAI_BASE_URL", "") or os.getenv("OPENAI_API_BASE", "")

    if api_key:
        os.environ["OPENAI_API_KEY"] = api_key
    if base_url:
        os.environ["OPENAI_API_BASE"] = base_url
        os.environ.setdefault("OPENAI_BASE_URL", base_url)


def build_llm(
    *,
    model_name: Optional[str] = None,
    provider: Optional[str] = None,
    callbacks: Any = None,
    temperature_env: Optional[str] = None,
    timeout_env: Optional[str] = None,
) -> Any:
    """Construct a ChatOpenAI instance.

    Args:
        model_name: Model name; defaults to LANGCHAIN_MODEL_NAME.
        provider: Optional provider id for API key/base URL mapping (e.g. ``deepseek``).
            If None, uses ``LANGCHAIN_PROVIDER``.
        callbacks: Optional LangChain callbacks.
        temperature_env: Env var name for temperature (default ``LANGCHAIN_TEMPERATURE``).
        timeout_env: Env var name for timeout in seconds (default ``TIMEOUT_SECONDS``).

    Returns:
        ChatOpenAI instance.

    Raises:
        RuntimeError: If langchain-openai is missing or model name is unset.
    """
    _sync_provider_env(provider=provider)
    name = model_name or os.getenv("LANGCHAIN_MODEL_NAME", "").strip()
    if not name:
        raise RuntimeError("LANGCHAIN_MODEL_NAME is not set")
    t_env = temperature_env or "LANGCHAIN_TEMPERATURE"
    to_env = timeout_env or "TIMEOUT_SECONDS"
    temperature = float(os.getenv(t_env, os.getenv("LANGCHAIN_TEMPERATURE", "0.0")))
    timeout = int(os.getenv(to_env, os.getenv("TIMEOUT_SECONDS", "120")))
    eff_provider = (provider or os.getenv("LANGCHAIN_PROVIDER", "openai")).lower()

    if eff_provider in {"openai-codex", "openai_codex"}:
        from src.providers.openai_codex import OpenAICodexLLM

        effort = os.getenv("LANGCHAIN_REASONING_EFFORT", "").strip().lower()
        return OpenAICodexLLM(
            model=name,
            temperature=temperature,
            timeout=timeout,
            reasoning_effort=effort or None,
        )

    if ChatOpenAI is None:
        raise RuntimeError("langchain-openai is not installed")
    # MiniMax requires temperature in (0.0, 1.0] — clamp to 0.01 when the
    # default 0.0 is used to avoid an API validation error.
    if eff_provider == "minimax" and temperature <= 0.0:
        temperature = 0.01
    # Optional reasoning activation for relays requiring opt-in (e.g. OpenRouter).
    # Moonshot/DeepSeek official APIs emit reasoning by default and ignore this field.
    effort = os.getenv("LANGCHAIN_REASONING_EFFORT", "").strip().lower()
    return ChatOpenAIWithReasoning(
        model=name,
        temperature=temperature,
        timeout=timeout,
        max_retries=int(os.getenv("MAX_RETRIES", "2")),
        callbacks=callbacks,
        extra_body={"reasoning": {"effort": effort}} if effort else None,
    )


def build_compact_llm() -> Optional[Any]:
    """Build a ChatOpenAI used only for Layer 2 context compression (summarise long history).

    Uses the same **OpenAI-compatible** HTTP API as the rest of the stack (``ChatOpenAI``).

    If ``COMPACT_LANGCHAIN_MODEL_NAME`` is unset or empty, returns ``None`` and the main
    agent model is used for compression (legacy behaviour).

    Set ``COMPACT_LANGCHAIN_PROVIDER`` to any provider id defined in ``_sync_provider_env``
    (``openai``, ``deepseek``, ``openrouter``, ``groq``, …) so the correct ``*_API_KEY`` and
    ``*_BASE_URL`` are applied — not limited to DeepSeek. Omit it to reuse the same provider
    as the main ``LANGCHAIN_PROVIDER`` with only a different model name.

    Returns:
        ChatOpenAI instance, or None.
    """
    if ChatOpenAI is None:
        return None
    name = os.getenv("COMPACT_LANGCHAIN_MODEL_NAME", "").strip()
    if not name:
        return None
    compact_prov = os.getenv("COMPACT_LANGCHAIN_PROVIDER", "").strip()
    provider = compact_prov if compact_prov else None
    return build_llm(
        model_name=name,
        provider=provider,
        temperature_env="COMPACT_LANGCHAIN_TEMPERATURE",
        timeout_env="COMPACT_TIMEOUT_SECONDS",
    )


def _extract_balanced_json(text: str) -> Optional[Dict[str, Any]]:
    """Extract the outermost JSON object from text using bracket balancing.

    Args:
        text: Text that may embed a JSON object.

    Returns:
        Parsed dict, or None on failure.
    """
    start = -1
    depth = 0
    in_string = False
    escape = False

    for i, ch in enumerate(text):
        if escape:
            escape = False
            continue
        if ch == "\\" and in_string:
            escape = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0 and start >= 0:
                candidate = text[start : i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    start = -1
    return None
