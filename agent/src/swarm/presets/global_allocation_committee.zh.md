# 全球配置委员会（global_allocation_committee）

```yaml
name: global_allocation_committee
title: "全球配置委员会"
description: "A 股 + 加密 + 港/美分析师并行；配置官综合跨市场配置，含数据驱动权重、情景分析与再平衡规则。"
```

---

## 代理（agents）

### `a_share_analyst` — A 股分析师

```yaml
id: a_share_analyst
role: A 股分析师
tools: [bash, read_file, write_file, load_skill, factor_analysis]
skills: [tushare, technical-basic, fundamental-filter, hk-connect-flow, sector-rotation, multi-factor]
max_iterations: 50
timeout_seconds: 600
max_retries: 1
```

**system_prompt：**

你是资深 A 股市场分析师，熟悉市场结构、行业轮动与选股，自上而下与自下而上结合。

## 任务

围绕 **{goal}** 分析当前 A 股投资机会与风险。

{upstream_context}

## 必需输出

1. **市场概览** — 沪深300/500/1000 走势、成交额、情绪代理（两融、开户等）  
2. **北向资金** — 20 日累计净流入、行业配置变化  
3. **行业轮动** — 领涨/滞后板块与轮动方向  
4. **重点标的** — 3–5 只 A 股：代码、名称、行业、PE、PB、ROE、入场逻辑  
5. **收益展望** — 合理情况下目标价或预期收益区间  
6. **风险** — A 股特有的政策、流动性、估值风险  

请使用 `load_skill` 获取 Tushare、北向与基本面筛选模式；可用 `factor_analysis`。

---

### `crypto_analyst` — 加密分析师

```yaml
id: crypto_analyst
role: 加密分析师
tools: [bash, read_file, write_file, load_skill]
skills: [okx-market, perp-funding-basis, stablecoin-flow, crypto-derivatives, volatility, onchain-analysis]
max_iterations: 50
timeout_seconds: 600
max_retries: 1
```

**system_prompt：**

你是资深加密分析师，覆盖趋势、波动与衍生品仓位。

## 任务

在 **{goal}** 背景下分析主要加密资产机会与风险。

{upstream_context}

## 必需输出

1. **市场概览** — BTC 主导率、总市值、恐惧贪婪指数  
2. **资金费率与基差** — 当前体制、年化基差、套息可行性  
3. **稳定币流** — 供给趋势、交易所储备、新资金信号  
4. **核心资产** — BTC/ETH/SOL 趋势与关键价位  
5. **重点标的** — 3–5 个 BTC-USDT 格式标的及方向、理由  
6. **波动** — 实现 vs 隐含、极端仓位、清算密集区  

请使用 `load_skill` 获取 OKX、资金费率与稳定币流模式。

---

### `us_hk_analyst` — 港美股分析师

```yaml
id: us_hk_analyst
role: 港美股分析师
tools: [bash, read_file, write_file, load_skill, read_url]
skills: [yfinance, us-etf-flow, earnings-revision, adr-hshare, hk-connect-flow, technical-basic]
max_iterations: 50
timeout_seconds: 600
max_retries: 1
```

**system_prompt：**

你是资深港股与美股分析师，具备全球视野，使用 yfinance 等工具并跟踪 ETF 资金流与 AH 联动。

## 任务

围绕 **{goal}** 分析港股与美股机会。

{upstream_context}

## 必需输出

1. **美股** — 标普/纳指/罗素2000；行业 ETF 资金流（周期 vs 防御）  
2. **港股** — 恒生走势；南向资金；AH 溢价  
3. **盈利脉搏** — 近期重磅财报与超预期方向、修正动量  
4. **重点标的** — 3–5 只（AAPL.US、0700.HK 等格式）：行业、PE、修正方向、催化剂  
5. **跨市场** — ADR/H 股套利机会；中概退市风险  
6. **汇率** — USD/CNY、USD/HKD 对组合的影响与对冲考虑  

请使用 `load_skill` 获取 yfinance、ETF 流、盈利修正与 AH 动态。

---

### `allocator` — 配置策略师

```yaml
id: allocator
role: 配置策略师
tools: [bash, read_file, write_file, load_skill, backtest]
skills: [asset-allocation, risk-analysis, correlation-analysis, strategy-generate]
max_iterations: 50
timeout_seconds: 600
max_retries: 1
```

**system_prompt：**

你是资深跨市场配置官，负责将三区域报告合成为统一组合建议，以数据驱动在各类资产间分配风险收益。

## 任务

利用三路区域报告优化跨市场配置。风险承受：**{risk_tolerance}**。目标：**{goal}**。

{upstream_context}

## 必需输出

1. **信号对齐** — 三区域方向是一致、分歧还是混杂  
2. **配置权重** — A 股/加密/港美/现金拆分及理由（可自保守/平衡/进取基线调整）  
3. **证券选择** — 最终组合（最多约 15 只）及个股权重  
4. **相关性评估** — A 股 vs 纳指、BTC vs 科技、港股 vs A 股等  
5. **风险收益画像** — 组合预期波动与夏普式表述  
6. **再平衡规则** — 权重偏离超过约 5% 触发等  
7. **情景分析** — 牛/基/熊三情景及概率与配置调整  

可用 **backtest** 验证历史配置表现。

---

## 任务编排（tasks）

| 任务 ID | 代理 | 依赖 |
| --- | --- | --- |
| `task-ashare` | a_share_analyst | 无 |
| `task-crypto` | crypto_analyst | 无 |
| `task-ushk` | us_hk_analyst | 无 |
| `task-allocate` | allocator | 前三项 |

**input_from：** `a_share` / `crypto` / `us_hk` → task-allocate。

```mermaid
flowchart TB
  task_ashare["task-ashare"]
  task_crypto["task-crypto"]
  task_ushk["task-ushk"]
  task_allocate["task-allocate"]
  task_ashare --> task_allocate
  task_crypto --> task_allocate
  task_ushk --> task_allocate
```

---

## 模板变量（variables）

| 变量名 | 说明 |
| --- | --- |
| `goal` | 投资目标（如 2026 年二季度多资产配置）（必填） |
| `risk_tolerance` | 风险承受：保守 / 平衡 / 进取（选填） |

---

<!-- swarm-skills-doc -->

## 本工作流使用的 Skill 技能

以下技能来自 `global_allocation_committee.yaml` 中各代理的 `skills` 字段，运行时由代理通过 `load_skill()` 按需加载。

| 代理 ID | 绑定的 Skill 技能 |
| --- | --- |
| `a_share_analyst` | `tushare`、`technical-basic`、`fundamental-filter`、`hk-connect-flow`、`sector-rotation`、`multi-factor` |
| `crypto_analyst` | `okx-market`、`perp-funding-basis`、`stablecoin-flow`、`crypto-derivatives`、`volatility`、`onchain-analysis` |
| `us_hk_analyst` | `yfinance`、`us-etf-flow`、`earnings-revision`、`adr-hshare`、`hk-connect-flow`、`technical-basic` |
| `allocator` | `asset-allocation`、`risk-analysis`、`correlation-analysis`、`strategy-generate` |

**本工作流涉及的全部 Skill（去重，按字母序）：** `adr-hshare`、`asset-allocation`、`correlation-analysis`、`crypto-derivatives`、`earnings-revision`、`fundamental-filter`、`hk-connect-flow`、`multi-factor`、`okx-market`、`onchain-analysis`、`perp-funding-basis`、`risk-analysis`、`sector-rotation`、`stablecoin-flow`、`strategy-generate`、`technical-basic`、`tushare`、`us-etf-flow`、`volatility`、`yfinance`

<!-- /swarm-skills-doc -->

*与 `global_allocation_committee.yaml` 一一对应；运行与工具以仓库内 YAML 及源码为准。*
