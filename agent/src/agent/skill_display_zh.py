"""Chinese display labels for the document skills catalog."""

from __future__ import annotations

CATEGORY_LABEL_ZH: dict[str, str] = {
    "tool": "文档与网页",
}

SKILL_NAME_ZH: dict[str, str] = {
    "doc-reader": "文档阅读",
    "web-reader": "网页阅读",
}

SKILL_INTRO_ZH: dict[str, str] = {
    "doc-reader": "读取 PDF、Word、Excel、PPT、图片和文本，配合 read_document。",
    "web-reader": "把网页转成 Markdown 正文，配合 read_url。",
}
