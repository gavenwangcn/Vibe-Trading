#!/usr/bin/env python3
"""在 swarm 中文说明 *.zh.md 末尾注入「本工作流使用的 Skill 技能」区块（数据来自同名 YAML）。"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from _swarm_zh_skills import MARK_END, MARK_START, skills_section_markdown

ROOT = Path(__file__).resolve().parent


def strip_old_block(text: str) -> str:
    if MARK_START not in text:
        return text
    pattern = re.escape(MARK_START) + r"[\s\S]*?" + re.escape(MARK_END)
    return re.sub(pattern, "", text, count=1)


def insert_before_footnote(text: str, block: str) -> str:
    """在最终斜体脚注（*与 `xxx.yaml`...）之前插入区块。"""
    m = re.search(r"\n\n(\*[^\n]*`[a-z0-9_]+\.yaml`[^\n]*)$", text, re.MULTILINE)
    if m:
        idx = m.start()
        return text[:idx].rstrip() + "\n\n" + block + "\n\n" + text[idx:].lstrip("\n")
    return text.rstrip() + "\n\n" + block + "\n"


def main() -> None:
    for path in sorted(ROOT.glob("*.yaml")):
        stem = path.stem
        md_path = ROOT / f"{stem}.zh.md"
        if not md_path.is_file():
            print("skip (no zh.md)", path.name)
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            continue
        inner = skills_section_markdown(data, stem, wrap_markers=False)
        block = MARK_START + "\n\n" + inner + "\n\n" + MARK_END
        raw = md_path.read_text(encoding="utf-8")
        raw = strip_old_block(raw)
        if MARK_START in raw:
            raise RuntimeError(f"strip failed: {md_path}")
        new_text = insert_before_footnote(raw, block)
        md_path.write_text(new_text, encoding="utf-8")
        print("updated", md_path.name)


if __name__ == "__main__":
    main()
