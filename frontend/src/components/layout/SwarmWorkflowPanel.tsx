import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ChevronDown, ChevronRight, Workflow, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api, type SwarmZhDocInfo } from "@/lib/api";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

export function SwarmWorkflowPanel() {
  const { t } = useI18n();
  const [treeOpen, setTreeOpen] = useState(false);
  const [items, setItems] = useState<SwarmZhDocInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ title: string; content: string } | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listSwarmZhDocs()
      .then((list) => {
        if (!cancelled) setItems(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openDoc = useCallback(async (stem: string) => {
    setDocLoading(true);
    setModal({ title: stem, content: "" });
    try {
      const d = await api.getSwarmZhDoc(stem);
      setModal({ title: d.title_zh, content: d.content });
    } catch {
      setModal({ title: stem, content: "*加载失败*" });
    } finally {
      setDocLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);

  return (
    <>
      <div className="border-t border-border/80" />

      <div className="px-2 py-1.5">
        <button
          type="button"
          onClick={() => setTreeOpen((o) => !o)}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs font-medium transition-colors",
            "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {treeOpen ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
          )}
          <Workflow className="h-3.5 w-3.5 shrink-0 text-primary/80" />
          <span className="truncate">{t.swarmWorkflow}</span>
        </button>

        {treeOpen && (
          <div className="mt-0.5 border-l border-border/70 ml-3 pl-2 space-y-0.5 max-h-52 overflow-y-auto">
            {loading ? (
              <p className="px-1 py-1 text-[11px] text-muted-foreground/70">{t.swarmWorkflowLoading}</p>
            ) : items.length === 0 ? (
              <p className="px-1 py-1 text-[11px] text-muted-foreground/70">{t.swarmWorkflowEmpty}</p>
            ) : (
              items.map((row) => (
                <button
                  key={row.stem}
                  type="button"
                  onClick={() => void openDoc(row.stem)}
                  className={cn(
                    "flex w-full items-start gap-1 rounded px-1.5 py-1 text-left text-[11px] leading-snug transition-colors",
                    "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                  title={row.stem}
                >
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50 select-none pt-0.5">
                    ├
                  </span>
                  <span className="min-w-0 flex-1 break-words">{row.title_zh}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <div className="border-t border-border/80" />

      {modal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="swarm-zh-doc-title"
          onClick={() => setModal(null)}
        >
          <div
            className="relative flex max-h-[min(90vh,880px)] w-full max-w-3xl flex-col rounded-lg border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3 shrink-0">
              <h2 id="swarm-zh-doc-title" className="text-sm font-semibold leading-snug pr-8">
                {docLoading ? "…" : modal.title}
              </h2>
              <button
                type="button"
                onClick={() => setModal(null)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title={t.swarmDocClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {docLoading ? (
                <p className="text-sm text-muted-foreground">{t.swarmWorkflowLoading}</p>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-muted/50 prose-table:border prose-table:border-border/50 prose-th:bg-muted/30 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-th:text-left prose-th:text-xs prose-td:text-xs">
                  <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}>
                    {modal.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
