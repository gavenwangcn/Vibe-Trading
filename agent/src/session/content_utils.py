"""OpenAI-style multimodal user messages (text + image_url parts)."""

from __future__ import annotations

from typing import Any, Dict, List, Union

# OpenAI Chat Completions: user message content is string or list of content parts.
UserContent = Union[str, List[Dict[str, Any]]]

MAX_STRING_CHARS = 100_000
MAX_PARTS = 20
MAX_DATA_URL_CHARS = 15_000_000


def plain_text_for_index(content: UserContent) -> str:
    """Plain text for search indexing and short storage fields."""
    if isinstance(content, str):
        return content.strip()
    lines: List[str] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            lines.append(str(part.get("text", "")))
        elif part.get("type") == "image_url":
            lines.append("[图片]")
    t = "\n".join(lines).strip()
    return t or "[图片]"


def to_llm_user_content(content: UserContent) -> Union[str, List[Dict[str, Any]]]:
    """Value to pass as the user turn for the model (string or multimodal parts)."""
    if isinstance(content, str):
        return content
    return list(content)


def validate_user_content(content: UserContent) -> None:
    """Raise ValueError if content is invalid or too large."""
    if isinstance(content, str):
        if not content.strip():
            raise ValueError("content text is empty")
        if len(content) > MAX_STRING_CHARS:
            raise ValueError("content text is too long")
        return
    if not isinstance(content, list) or len(content) == 0:
        raise ValueError("content parts must be a non-empty list")
    if len(content) > MAX_PARTS:
        raise ValueError(f"at most {MAX_PARTS} content parts allowed")
    has_visible = False
    for part in content:
        if not isinstance(part, dict):
            raise ValueError("each content part must be an object")
        ptype = part.get("type")
        if ptype == "text":
            txt = str(part.get("text", ""))
            if txt.strip():
                has_visible = True
        elif ptype == "image_url":
            iu = part.get("image_url")
            if not isinstance(iu, dict):
                raise ValueError("image_url must be an object")
            url = str(iu.get("url", "")).strip()
            if not url:
                raise ValueError("image url is empty")
            if url.startswith("data:"):
                if not url.startswith("data:image/"):
                    raise ValueError("only data:image/* URLs are allowed for inline images")
                if len(url) > MAX_DATA_URL_CHARS:
                    raise ValueError("image payload is too large")
            elif url.startswith("https://") or url.startswith("http://"):
                if len(url) > 8192:
                    raise ValueError("image URL is too long")
            else:
                raise ValueError("image url must be http(s) or data:image/...")
            has_visible = True
        else:
            raise ValueError(f"unsupported content part type: {ptype}")
    if not has_visible:
        raise ValueError("content must include at least one text or image part")


def enrich_user_content_with_recall(
    base: UserContent,
    recall_prefix: str,
) -> UserContent:
    """Prepend persistent-memory recall block to the user message."""
    if not recall_prefix.strip():
        return base
    if isinstance(base, str):
        return recall_prefix + base
    out: List[Dict[str, Any]] = []
    merged_first = False
    for part in base:
        if not merged_first and isinstance(part, dict) and part.get("type") == "text":
            merged_first = True
            p = dict(part)
            p["text"] = recall_prefix + str(part.get("text", ""))
            out.append(p)
        else:
            out.append(part)
    if not merged_first:
        out.insert(0, {"type": "text", "text": recall_prefix})
    return out


def recall_query_text(content: UserContent) -> str:
    """Short text for memory similarity search."""
    t = plain_text_for_index(content)
    return t[:4000]


def trace_prompt_preview(content: UserContent, limit: int = 500) -> str:
    """Log-friendly preview (no huge base64)."""
    if isinstance(content, str):
        return content[:limit]
    parts: List[str] = []
    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") == "text":
            parts.append(str(part.get("text", ""))[:limit])
        elif part.get("type") == "image_url":
            url = ""
            iu = part.get("image_url")
            if isinstance(iu, dict):
                url = str(iu.get("url", ""))
            if url.startswith("data:image"):
                parts.append("[image data]")
            else:
                parts.append(f"[image] {url[:120]}")
    s = " | ".join(parts)
    return s[:limit]
