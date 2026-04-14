import { Bot, TrendingUp, Globe, Sparkles, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n";

interface Example {
  title: string;
  desc: string;
  prompt: string;
}

interface Category {
  label: string;
  icon: any;
  color: string;
  examples: Example[];
}

const CATEGORIES: Category[] = [
  {
    label: "多市场回测",
    icon: <TrendingUp className="h-4 w-4" />,
    color: "text-red-400 border-red-500/30 hover:border-red-500/60 hover:bg-red-500/5",
    examples: [
      {
        title: "跨市场组合",
        desc: "A 股 + 加密 + 美股，使用风险平价优化",
        prompt: "回测 2024 全年风险平价组合：000001.SZ、BTC-USDT、AAPL，并对比等权基准",
      },
      {
        title: "BTC 5 分钟 MACD 策略",
        desc: "分钟级加密回测，使用 OKX 实时数据",
        prompt: "回测 BTC-USDT 5 分钟 MACD 策略，fast=12 slow=26 signal=9，最近 30 天",
      },
      {
        title: "美股科技最大分散组合",
        desc: "通过 yfinance 对 FAANG+ 做组合优化",
        prompt: "对 AAPL、MSFT、GOOGL、AMZN、NVDA 使用 max_diversification 组合优化器，回测 2024 全年",
      },
    ],
  },
  {
    label: "研究与分析",
    icon: <Sparkles className="h-4 w-4" />,
    color: "text-amber-400 border-amber-500/30 hover:border-amber-500/60 hover:bg-amber-500/5",
    examples: [
      {
        title: "多因子 Alpha 模型",
        desc: "在 300 只股票上做 IC 加权因子合成",
        prompt: "在沪深 300 成分股上，使用动量、反转、波动率、换手率构建多因子 Alpha，并按 IC 加权，回测 2023-2024",
      },
      {
        title: "期权 Greeks 分析",
        desc: "Black-Scholes 定价 + Delta/Gamma/Theta/Vega",
        prompt: "用 Black-Scholes 计算期权 Greeks：spot=100, strike=105, risk-free rate=3%, vol=25%, expiry=90 days，并分析 Delta/Gamma/Theta/Vega",
      },
    ],
  },
  {
    label: "Swarm 团队",
    icon: <Users className="h-4 w-4" />,
    color: "text-violet-400 border-violet-500/30 hover:border-violet-500/60 hover:bg-violet-500/5",
    examples: [
      {
        title: "投委会评审",
        desc: "多代理辩论：多空观点、风险复核、PM 决策",
        prompt: "[Swarm Team Mode] 使用 investment_committee 预设，评估在当前市场条件下 NVDA 应该做多还是做空",
      },
      {
        title: "量化策略工作台",
        desc: "筛选 → 因子研究 → 回测 → 风险审计",
        prompt: "[Swarm Team Mode] 使用 quant_strategy_desk 预设，寻找并回测沪深 300 上最优动量策略",
      },
    ],
  },
  {
    label: "文档与网页研究",
    icon: <Globe className="h-4 w-4" />,
    color: "text-blue-400 border-blue-500/30 hover:border-blue-500/60 hover:bg-blue-500/5",
    examples: [
      {
        title: "分析财报 PDF",
        desc: "上传 PDF 并提问财务相关问题",
        prompt: "总结已上传财报中的关键财务指标、主要风险和未来展望",
      },
      {
        title: "网页研究：宏观展望",
        desc: "读取最新网页信息做宏观分析",
        prompt: "阅读最新美联储会议纪要，并总结对股票和加密市场的关键影响",
      },
    ],
  },
];

const CAPABILITY_CHIPS = [
  "56 个金融技能",
  "25 个 Swarm 预设",
  "19 个 Agent 工具",
  "3 大市场：A 股 · 加密 · 港美股",
  "分钟到日线级别",
  "4 种组合优化器",
  "15+ 风险指标",
  "期权与衍生品",
  "PDF 与网页研究",
  "因子分析与机器学习",
];

interface Props {
  onExample: (s: string) => void;
}

export function WelcomeScreen({ onExample }: Props) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 text-center">
      <div className="space-y-3">
        <div className="h-16 w-16 mx-auto rounded-2xl bg-gradient-to-br from-primary/80 to-info/80 flex items-center justify-center shadow-lg">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Vibe-Trading</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto leading-relaxed">
            你的专业金融 Agent 团队
          </p>
          <p className="text-sm text-muted-foreground mt-2 max-w-md leading-relaxed mx-auto">
            {t.describeStrategy}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-2 max-w-lg">
        {CAPABILITY_CHIPS.map((chip) => (
          <span
            key={chip}
            className="px-2.5 py-1 text-xs rounded-full border border-border/60 text-muted-foreground bg-muted/30"
          >
            {chip}
          </span>
        ))}
      </div>

      <div className="w-full max-w-2xl text-left space-y-4">
        <p className="text-xs text-muted-foreground px-1">{t.examples}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.label} className="space-y-2">
              <div className={`flex items-center gap-1.5 text-xs font-medium px-1 ${cat.color.split(" ").filter(c => c.startsWith("text-")).join(" ")}`}>
                {cat.icon}
                <span>{cat.label}</span>
              </div>
              <div className="space-y-1.5">
                {cat.examples.map((ex) => (
                  <button
                    key={ex.title}
                    onClick={() => onExample(ex.prompt)}
                    className={`block w-full text-left px-3 py-2.5 rounded-xl border transition-colors ${cat.color}`}
                  >
                    <span className="text-sm font-medium text-foreground leading-snug">
                      {ex.title}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5 leading-snug">
                      {ex.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
