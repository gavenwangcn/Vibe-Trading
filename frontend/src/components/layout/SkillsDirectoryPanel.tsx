import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { BookOpen, ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { api, type SkillCatalogCategory, type SkillCatalogResponse } from "@/lib/api";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeHighlight];

function SkillLine(props: {
  name: string;
  nameZh: string;
  introZh: string;
  onOpen: () => void;
}) {
  const { name, nameZh, introZh, onOpen } = props;
  /** 悬停仅中文：原生 title 与浮层都不带英文 description / id */
  const hoverZh = introZh || nameZh;
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        title={hoverZh}
        onMouseEnter={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setTip({ left: r.left, top: r.bottom + 6 });
        }}
        onMouseLeave={() => setTip(null)}
        onFocus={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setTip({ left: r.left, top: r.bottom + 6 });
        }}
        onBlur={() => setTip(null)}
        className={cn(
          "flex w-full cursor-pointer items-start gap-1 rounded px-1.5 py-1.5 text-left transition-colors",
          "hover:bg-muted"
        )}
      >
        <span className="shrink-0 font-mono text-[9px] text-muted-foreground/50 select-none pt-0.5">
          ├
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0">
            <span className="text-[11px] font-medium text-foreground">{nameZh}</span>
            <span className="font-mono text-[9px] text-muted-foreground/80">{name}</span>
          </span>
          {introZh ? (
            <span
              className={cn(
                "mt-0.5 block w-full min-w-0 break-words",
                "text-[9px] leading-[1.45] text-muted-foreground/85",
                "line-clamp-4 overflow-hidden"
              )}
            >
              {introZh}
            </span>
          ) : null}
        </span>
      </button>
      {tip && introZh
        ? createPortal(
            <div
              className="pointer-events-none fixed z-[200] w-[min(300px,calc(100vw-2rem))] rounded-md border border-border bg-popover px-2.5 py-2 text-[9px] leading-snug text-popover-foreground shadow-lg max-h-48 overflow-y-auto"
              style={{ left: tip.left, top: tip.top }}
              role="tooltip"
            >
              <p className="text-foreground/95">{introZh}</p>
            </div>,
            document.body
          )
        : null}
    </>
  );
}

export function SkillsDirectoryPanel() {
  const { t } = useI18n();
  const [treeOpen, setTreeOpen] = useState(true);
  const [catalog, setCatalog] = useState<SkillCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [catOpen, setCatOpen] = useState<Record<string, boolean>>({});
  const [modal, setModal] = useState<{
    title: string;
    nameZh: string;
    introZh: string;
    content: string;
  } | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listSkillsCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch(() => {
        if (!cancelled) setCatalog(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleCat = useCallback((id: string) => {
    setCatOpen((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  }, []);

  const isCatOpen = useCallback((id: string) => catOpen[id] ?? true, [catOpen]);

  const openSkill = useCallback(async (name: string) => {
    setDocLoading(true);
    setModal({ title: name, nameZh: "", introZh: "", content: "" });
    try {
      const d = await api.getSkillDoc(name);
      setModal({
        title: d.title,
        nameZh: d.name_zh,
        introZh: d.intro_zh,
        content: d.content,
      });
    } catch {
      setModal({
        title: name,
        nameZh: "",
        introZh: "",
        content: `*${t.skillsDocLoadError}*`,
      });
    } finally {
      setDocLoading(false);
    }
  }, [t.skillsDocLoadError]);

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modal]);

  const categories: SkillCatalogCategory[] = catalog?.categories ?? [];

  return (
    <>
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
          <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary/80" />
          <span className="truncate">{t.skillsDirectory}</span>
        </button>

        {treeOpen && (
          <div className="mt-0.5 ml-1 max-h-64 space-y-1 overflow-y-auto border-l border-border/70 pl-2 pr-0.5">
            {loading ? (
              <p className="px-1 py-1 text-[11px] text-muted-foreground/70">{t.skillsCatalogLoading}</p>
            ) : categories.length === 0 ? (
              <p className="px-1 py-1 text-[11px] text-muted-foreground/70">{t.skillsCatalogEmpty}</p>
            ) : (
              categories.map((cat) => (
                <div key={cat.id} className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => toggleCat(cat.id)}
                    className={cn(
                      "flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] font-medium transition-colors",
                      "text-foreground/90 hover:bg-muted/80"
                    )}
                  >
                    {isCatOpen(cat.id) ? (
                      <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
                    )}
                    <span className="truncate">
                      {cat.label_zh}
                      <span className="ml-1 font-mono text-[10px] font-normal text-muted-foreground/70">
                        ({cat.id})
                      </span>
                    </span>
                  </button>
                  {isCatOpen(cat.id) && (
                    <div className="ml-2 space-y-0 border-l border-dashed border-border/50 pl-2">
                      {cat.skills.map((s) => (
                        <SkillLine
                          key={s.name}
                          name={s.name}
                          nameZh={s.name_zh}
                          introZh={s.intro_zh}
                          onOpen={() => void openSkill(s.name)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {modal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="skill-doc-title"
          onClick={() => setModal(null)}
        >
          <div
            className="relative flex max-h-[min(90vh,880px)] w-full max-w-3xl flex-col rounded-lg border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <h2 id="skill-doc-title" className="pr-8 text-sm font-semibold leading-snug">
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
              {!docLoading && modal.introZh ? (
                <p className="text-xs leading-relaxed text-muted-foreground">{modal.introZh}</p>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {docLoading ? (
                <p className="text-sm text-muted-foreground">{t.skillsCatalogLoading}</p>
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
