import type { ReactNode } from "react";
import { Bot, FileText, Globe } from "lucide-react";

interface Example {
  title: string;
  desc: string;
  prompt: string;
}

interface Category {
  label: string;
  icon: ReactNode;
  color: string;
  examples: Example[];
}

const CATEGORIES: Category[] = [
  {
    label: "文档问答",
    icon: <FileText className="h-4 w-4" />,
    color: "text-sky-400 border-sky-500/30 hover:border-sky-500/60 hover:bg-sky-500/5",
    examples: [
      {
        title: "读上传的文档",
        desc: "从 PDF、Word 或表格里回答问题",
        prompt: "请阅读我刚上传的文档，先给出摘要，再列出可以继续追问的问题",
      },
      {
        title: "对照两段内容",
        desc: "只根据文档原文回答，不补充外部事实",
        prompt: "只根据已读取的文档回答：这份材料的结论是什么，有哪些限制条件？",
      },
    ],
  },
  {
    label: "网页阅读",
    icon: <Globe className="h-4 w-4" />,
    color: "text-emerald-400 border-emerald-500/30 hover:border-emerald-500/60 hover:bg-emerald-500/5",
    examples: [
      {
        title: "阅读一个链接",
        desc: "把网页转成正文后再回答",
        prompt: "请读取这个网页并总结要点：https://example.com",
      },
      {
        title: "按问题摘录",
        desc: "回答时标出网页里的依据",
        prompt: "读取我给出的网页，只回答我问的问题，并引用对应段落",
      },
    ],
  },
];

const CAPABILITY_CHIPS = ["文档阅读", "网页阅读", "会话问答", "后续可接飞书文档 MCP"];

interface Props {
  onExample: (s: string) => void;
}

export function WelcomeScreen({ onExample }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 text-center">
      <div className="space-y-3">
        <div className="h-16 w-16 mx-auto rounded-2xl bg-gradient-to-br from-primary/80 to-info/80 flex items-center justify-center shadow-lg">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold tracking-tight">文档问答</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-md leading-relaxed mx-auto">
            上传文档或给出网页链接，直接提问。
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
        <p className="text-xs text-muted-foreground px-1">试一个例子：</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CATEGORIES.map((cat) => (
            <div key={cat.label} className="space-y-2">
              <div className={`flex items-center gap-1.5 text-xs font-medium px-1 ${cat.color.split(" ").filter((c) => c.startsWith("text-")).join(" ")}`}>
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
