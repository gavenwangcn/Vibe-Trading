#!/usr/bin/env python3
"""One-off generator: swarm/*.yaml -> *.zh.md 中文说明（可重复运行以同步结构）。

手工维护的 *.zh.md 若需与 YAML 中 agents.skills 对齐末尾「本工作流使用的 Skill 技能」区块，
可运行同目录下 `_patch_zh_skills_sections.py`。
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

from _swarm_zh_skills import skills_section_markdown

ROOT = Path(__file__).resolve().parent

# 已由人工全文翻译的预设，勿用本脚本覆盖（与 xxx.yaml 同名的 xxx.zh.md）
HAND_MAINTAINED_STEMS: frozenset[str] = frozenset(
    {
        "commodity_research_team",
        "convertible_bond_team",
        "credit_research_team",
        "crypto_research_lab",
        "crypto_trading_desk",
        "derivatives_strategy_desk",
        "earnings_research_desk",
        "equity_research_team",
        "etf_allocation_desk",
        "event_driven_task_force",
        "factor_research_committee",
        "fund_selection_panel",
        "fundamental_research_team",
        "geopolitical_war_room",
        "global_allocation_committee",
        "global_equities_desk",
        "investment_committee",
        "macro_rates_fx_desk",
        "macro_strategy_forum",
        "ml_quant_lab",
        "pairs_research_lab",
        "portfolio_review_board",
        "quant_strategy_desk",
        "risk_committee",
        "sector_rotation_team",
        "sentiment_intelligence_team",
        "social_alpha_team",
        "statistical_arbitrage_desk",
        "technical_analysis_panel",
    }
)

# 各预设 description 的中文说明（与 YAML 首行 description 对应）
DESC_ZH: dict[str, str] = {
    "convertible_bond_team": (
        "三维并行分析——债底、股权期权性、内嵌期权价值——再收敛为可转债投资策略。"
    ),
    "social_alpha_team": (
        "Twitter、Telegram、Reddit 并行分析 → Alpha 合成器提炼可交易的社媒情绪因子。"
    ),
    "geopolitical_war_room": (
        "地缘分析、能源冲击、供应链影响并行推进，再由首席策略师汇总，产出地缘危机下的应急资产配置预案。"
    ),
    "event_driven_task_force": (
        "事件扫描 → 深度影响分析 → 策略构建：顺序深钻链，模拟事件驱动对冲基金专题调查组工作流。"
    ),
    "global_allocation_committee": (
        "A 股、加密、港/美分析师并行；配置官做跨市场配置，含数据驱动权重、情景分析与再平衡规则。"
    ),
    "crypto_research_lab": (
        "链上数据 + DeFi 协议 + 市场情绪三维并行 → Alpha 合成器收敛为投资建议。"
    ),
    "factor_research_committee": (
        "因子挖掘与因子验证并行 → 因子组合构建 → 回测评审：量化基金内部投研评审流。"
    ),
    "fundamental_research_team": (
        "财务 / 估值 / 质量三维并行分析 → 研究编辑整合为买方深度研报。"
    ),
    "ml_quant_lab": (
        "特征工程与模型设计并行 → 流向回测工程师做严格样本外验证。"
    ),
    "equity_research_team": (
        "宏观 → 行业 → 个股三层深度研究 → 研究编辑汇总为完整报告。"
    ),
    "technical_analysis_panel": (
        "经典技术分析 + 一目均衡 + 谐波 + 波浪 + SMC 并行 → 信号聚合器打分共识与共振。"
    ),
    "credit_research_team": (
        "信用质量 + 利率环境 + 行业信用三维并行 → 固收策略师合成完整债券投资策略。"
    ),
    "macro_rates_fx_desk": (
        "跨资产宏观台：全球利率 + 外汇策略 + 商品/通胀 + 宏观 PM。覆盖央行政策、收益率曲线、货币头寸与宏观驱动配置。"
    ),
    "risk_committee": (
        "回撤、尾部风险、市场体制评审并行；风控负责人签字确认。"
    ),
    "quant_strategy_desk": (
        "选股筛选与因子研究并行 → 策略回测 → 风险审计。"
    ),
    "investment_committee": (
        "多空辩论 → 风险复核 → PM 最终决策：买方基金投委会流程。"
    ),
    "sector_rotation_team": (
        "经济周期 + 景气 + 资金流向并行 → 轮动策略师构建并回测行业轮动策略。"
    ),
    "macro_strategy_forum": (
        "全球 + 国内 + 政策视角并行；首席策略师输出综合跨资产配置指引。"
    ),
    "statistical_arbitrage_desk": (
        "配对扫描与微观结构分析并行 → 收敛至套利策略师构建策略 → 最终风控复核。"
    ),
    "pairs_research_lab": (
        "相关性扫描与协整检验并行 → 收敛至配对策略师设计策略 → 最终微观结构评估执行可行性。"
    ),
    "portfolio_review_board": (
        "业绩归因、风险复核、执行质量并行；CIO 汇总为再平衡决策。"
    ),
    "sentiment_intelligence_team": (
        "新闻情报 / 社交情绪 / 资金流向并行 → 情绪信号合成器输出综合得分与反转信号。"
    ),
    "commodity_research_team": (
        "供需两侧并行深研，再由周期策略师合成投资论点——DAG 工作流。"
    ),
    "derivatives_strategy_desk": (
        "波动率分析 → 策略设计 → Greeks 风控：顺序期权交易台工作流。"
    ),
    "crypto_trading_desk": (
        "偏执行的加密台：资金费率/基差 + 清算/微观结构 + 链上/资金流 + 风控经理。超越研究，含仓位、执行时机与风险闸门。"
    ),
    "etf_allocation_desk": (
        "ETF 筛选 + 宏观配置 + 风险预算三维并行 → 组合优化器构建最终 ETF 组合并回测。"
    ),
    "global_equities_desk": (
        "跨市场股票研究：A 股 + 港美 + 加密 + 全球策略师。含基本面筛选、盈利、ETF 资金流与跨市场选股。"
    ),
    "fund_selection_panel": (
        "多维量化筛选 → Brinson 业绩归因与风格分析 → FOF 权重优化，顺序专业复核链。"
    ),
    "earnings_research_desk": (
        "盈利聚焦团队：基本面 + 盈利修正跟踪 + 期权/事件 + 盈利策略师。深挖财报、一致预期修正、财报交易与财报后漂移。"
    ),
}


def _task_snippet(system_prompt: str) -> str:
    m = re.search(r"## Task\s*\n([\s\S]*?)(?=\n## |\Z)", system_prompt)
    if not m:
        return ""
    block = m.group(1).strip()
    # 去掉 {upstream_context} 占位行
    lines = [ln for ln in block.splitlines() if "{upstream_context}" not in ln and ln.strip()]
    return " ".join(lines[:3])[:280]


def build_md(data: dict) -> str:
    name = data.get("name", "")
    title = data.get("title", "")
    desc_en = data.get("description", "")
    desc_zh = DESC_ZH.get(name, desc_en)

    lines: list[str] = []
    lines.append(f"# {title} — 中文说明")
    lines.append("")
    lines.append(f"- **预设标识（`name`）**：`{name}`")
    lines.append(f"- **英文标题**：{title}")
    lines.append("")
    lines.append("## 概述")
    lines.append("")
    lines.append(desc_zh)
    lines.append("")
    if desc_zh != desc_en:
        lines.append(f"> 英文原文：`{desc_en}`")
        lines.append("")

    agents = data.get("agents") or []
    lines.append("## 代理角色（Agents）")
    lines.append("")
    lines.append("| 代理 ID | 角色（Role） | 任务摘要（摘自 YAML，英文） |")
    lines.append("| --- | --- | --- |")
    for a in agents:
        aid = a.get("id", "")
        role = a.get("role", "")
        sp = a.get("system_prompt") or ""
        snip = _task_snippet(sp).replace("|", "\\|")
        if not snip:
            snip = "—"
        lines.append(f"| `{aid}` | {role} | {snip} |")
    lines.append("")
    lines.append("*完整系统提示、工具列表与技能绑定请以同名的 `.yaml` 为准。*")
    lines.append("")

    tasks = data.get("tasks") or []
    lines.append("## 任务与依赖（DAG）")
    lines.append("")
    for t in tasks:
        tid = t.get("id", "")
        agent_id = t.get("agent_id", "")
        dep = t.get("depends_on") or []
        inp = t.get("input_from") or {}
        dep_s = "无" if not dep else ", ".join(f"`{d}`" for d in dep)
        lines.append(f"- **`{tid}`** → 代理 `{agent_id}`；`depends_on`: {dep_s}")
        if inp:
            lines.append(f"  - `input_from`: {inp}")
    lines.append("")

    # Mermaid：先声明全部任务节点，再画边（避免仅引用未声明的节点）
    if tasks:
        lines.append("```mermaid")
        lines.append("flowchart TB")
        for t in tasks:
            tid = t["id"]
            safe = re.sub(r"[^a-zA-Z0-9_]", "_", tid)
            lines.append(f'  {safe}["{tid}"]')
        for t in tasks:
            ts = re.sub(r"[^a-zA-Z0-9_]", "_", t["id"])
            for d in t.get("depends_on") or []:
                ds = re.sub(r"[^a-zA-Z0-9_]", "_", d)
                lines.append(f"  {ds} --> {ts}")
        lines.append("```")
        lines.append("")

    vars_ = data.get("variables") or []
    if vars_:
        lines.append("## 模板变量（Variables）")
        lines.append("")
        lines.append("| 变量名 | 说明（YAML 原文） | 是否必填 |")
        lines.append("| --- | --- | --- |")
        for v in vars_:
            vn = v.get("name", "")
            vd = (v.get("description") or "").replace("|", "\\|")
            req = "是" if v.get("required") else "否"
            lines.append(f"| `{vn}` | {vd} | {req} |")
        lines.append("")

    lines.append("---")
    lines.append("")
    lines.append(skills_section_markdown(data, name, wrap_markers=False))
    lines.append("")
    lines.append("---")
    lines.append("*本文件由 `agent/config/swarm/_generate_zh_readmes.py` 根据同名 YAML 自动生成，便于中文阅读；执行逻辑以源码与 YAML 为准。*")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    for path in sorted(ROOT.glob("*.yaml")):
        if path.stem in HAND_MAINTAINED_STEMS:
            print("skip (hand-maintained)", path.name)
            continue
        data = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            continue
        out = path.with_suffix(".zh.md")
        out.write_text(build_md(data), encoding="utf-8")
        print("wrote", out.relative_to(ROOT.parent.parent.parent))


if __name__ == "__main__":
    main()
