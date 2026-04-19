"""从 swarm YAML 生成「本工作流使用的 Skill 技能」Markdown 区块（供中文说明 *.zh.md 与生成脚本复用）。"""

from __future__ import annotations

from typing import Any

MARK_START = "<!-- swarm-skills-doc -->"
MARK_END = "<!-- /swarm-skills-doc -->"


def skills_section_markdown(data: dict[str, Any], yaml_stem: str, *, wrap_markers: bool = False) -> str:
    """生成 Skill 说明区块。wrap_markers=True 时包一层 HTML 注释，便于 _patch_zh_skills_sections 幂等更新。"""
    agents = data.get("agents") or []
    rows: list[tuple[str, list[str]]] = []
    all_skills: set[str] = set()
    for a in agents:
        aid = a.get("id", "")
        sk = a.get("skills")
        if not isinstance(sk, list):
            sk = []
        skills = [str(s).strip() for s in sk if str(s).strip()]
        rows.append((aid, skills))
        all_skills.update(skills)

    lines: list[str] = []
    if wrap_markers:
        lines.append(MARK_START)
        lines.append("")
    lines.append("## 本工作流使用的 Skill 技能")
    lines.append("")
    lines.append(
        f"以下技能来自 `{yaml_stem}.yaml` 中各代理的 `skills` 字段，运行时由代理通过 `load_skill()` 按需加载。"
    )
    lines.append("")
    lines.append("| 代理 ID | 绑定的 Skill 技能 |")
    lines.append("| --- | --- |")
    for aid, skills in rows:
        if not skills:
            cell = "—（未绑定）"
        else:
            cell = "、".join(f"`{s}`" for s in skills)
        lines.append(f"| `{aid}` | {cell} |")
    lines.append("")
    ordered = sorted(all_skills)
    if ordered:
        joined = "、".join(f"`{s}`" for s in ordered)
        lines.append(f"**本工作流涉及的全部 Skill（去重，按字母序）：** {joined}")
    else:
        lines.append("**本工作流涉及的全部 Skill：** 无（YAML 中未声明 `skills`）")
    if wrap_markers:
        lines.append("")
        lines.append(MARK_END)
    return "\n".join(lines)
