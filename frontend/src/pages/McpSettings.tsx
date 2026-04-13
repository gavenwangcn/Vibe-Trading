import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Loader2,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
  FlaskConical,
} from "lucide-react";
import {
  api,
  type McpServer,
  type McpServerUpsert,
  type McpImportResult,
  type McpToolInfo,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

const emptyForm: McpServerUpsert = {
  id: "",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-everything"],
  env: {},
  enabled: true,
  transport: "stdio",
  url: "",
};

const TOOL_CHIP_PREVIEW = 20;

export function McpSettings() {
  const { t } = useI18n();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [form, setForm] = useState<McpServerUpsert>(emptyForm);
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [expandedServerId, setExpandedServerId] = useState<string | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, McpToolInfo[]>>({});
  const [loadingToolsId, setLoadingToolsId] = useState<string | null>(null);
  const [toolsErrById, setToolsErrById] = useState<Record<string, string | null>>({});
  const [showAllToolsFor, setShowAllToolsFor] = useState<Record<string, boolean>>({});

  const load = useCallback(() => {
    setLoading(true);
    api
      .listMcpServers()
      .then(setServers)
      .catch(() => setServers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveNew = async () => {
    if (!form.id.trim()) {
      setMsg(t.mcpNeedId);
      return;
    }
    const isSse = form.transport === "sse";
    if (isSse && !(form.url || "").trim()) {
      setMsg(t.mcpNeedSseUrl);
      return;
    }
    if (!isSse && !form.command?.trim()) {
      setMsg(t.mcpNeedIdCommand);
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const body: McpServerUpsert = {
        ...form,
        id: form.id.trim(),
        command: isSse ? "" : (form.command || "").trim(),
        transport: isSse ? "sse" : "stdio",
        url: isSse ? (form.url || "").trim() : form.url || undefined,
      };
      await api.upsertMcpServer(form.id.trim(), body);
      setForm(emptyForm);
      load();
      setMsg(t.mcpSaved);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: McpServer) => {
    try {
      await api.upsertMcpServer(s.id, {
        id: s.id,
        command: s.command,
        args: s.args,
        env: s.env,
        enabled: !s.enabled,
        transport: s.transport,
        url: s.url ?? undefined,
      });
      load();
    } catch {
      /* ignore */
    }
  };

  const remove = async (id: string) => {
    if (!confirm(t.mcpDeleteConfirm)) return;
    try {
      await api.deleteMcpServer(id);
      if (expandedServerId === id) setExpandedServerId(null);
      setServerTools((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      load();
    } catch {
      /* ignore */
    }
  };

  const loadToolsFor = useCallback(
    async (id: string, refresh: boolean) => {
      setLoadingToolsId(id);
      setToolsErrById((prev) => ({ ...prev, [id]: null }));
      try {
        const r = await api.getMcpServerTools(id, refresh);
        setServerTools((prev) => ({ ...prev, [id]: r.tools }));
        if (r.error) {
          setToolsErrById((prev) => ({ ...prev, [id]: r.error ?? null }));
        }
      } catch (e) {
        setServerTools((prev) => ({ ...prev, [id]: [] }));
        setToolsErrById((prev) => ({
          ...prev,
          [id]: `${t.mcpToolsLoadFailed}: ${String(e)}`,
        }));
      } finally {
        setLoadingToolsId(null);
      }
    },
    [t.mcpToolsLoadFailed]
  );

  const toggleExpandServer = async (id: string) => {
    if (expandedServerId === id) {
      setExpandedServerId(null);
      return;
    }
    setExpandedServerId(id);
    if (!serverTools[id]) {
      await loadToolsFor(id, false);
    }
  };

  const test = async (id: string) => {
    setTesting(id);
    setMsg(null);
    try {
      const r = await api.testMcpServer(id);
      setMsg(
        r.ok
          ? t.mcpTestOk.replace("{n}", String(r.tool_count))
          : `${t.mcpTestFail}: ${r.error || ""}`
      );
      setServerTools((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      load();
      if (expandedServerId === id) {
        await loadToolsFor(id, false);
      }
    } catch (e) {
      setMsg(String(e));
    } finally {
      setTesting(null);
    }
  };

  const doImport = async () => {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(importText) as Record<string, unknown>;
    } catch {
      setMsg(t.mcpImportInvalidJson);
      return;
    }
    setSaving(true);
    try {
      const r: McpImportResult = await api.importMcpJson(raw);
      // eslint-disable-next-line no-console
      console.info("[MCP Import] result", r);
      const skipLines =
        r.skipped?.map((s) => `${s.id}: ${s.reason}`).join(" | ") ?? "";
      if (r.imported > 0) {
        setMsg(
          skipLines
            ? t.mcpImportedPartial.replace("{n}", String(r.imported)).replace("{s}", skipLines)
            : t.mcpImported.replace("{n}", String(r.imported))
        );
      } else {
        setMsg(
          skipLines
            ? t.mcpImportNoneDetail.replace("{s}", skipLines)
            : t.mcpImportNone
        );
      }
      setImportText("");
      load();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[MCP Import] failed", e);
      setMsg(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-3">
        <Link
          to="/agent"
          className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          title={t.goBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <PlugZap className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-lg font-semibold">{t.mcpTitle}</h1>
          <p className="text-sm text-muted-foreground">{t.mcpSubtitle}</p>
        </div>
      </div>

      {msg && (
        <p className="text-sm rounded-md border border-border bg-muted/40 px-3 py-2 text-foreground">{msg}</p>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Plus className="h-4 w-4" /> {t.mcpNewServer}
        </h2>
        <div className="grid gap-2 rounded-lg border border-border p-4 bg-card">
          <label className="text-xs text-muted-foreground">{t.mcpServerId}</label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
            value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            placeholder="chrome-devtools"
          />
          <label className="text-xs text-muted-foreground">{t.mcpTransport}</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.transport || "stdio"}
            onChange={(e) =>
              setForm((f) => ({ ...f, transport: e.target.value as "stdio" | "sse" }))
            }
          >
            <option value="stdio">stdio (command + args)</option>
            <option value="sse">SSE (remote URL)</option>
          </select>
          {form.transport === "sse" && (
            <>
              <label className="text-xs text-muted-foreground">{t.mcpSseUrl}</label>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                value={form.url || ""}
                onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                placeholder="http://127.0.0.1:8099/sse"
              />
            </>
          )}
          {form.transport !== "sse" && (
            <>
              <label className="text-xs text-muted-foreground">{t.mcpCommand}</label>
              <input
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
                value={form.command}
                onChange={(e) => setForm((f) => ({ ...f, command: e.target.value }))}
              />
              <label className="text-xs text-muted-foreground">{t.mcpArgsJson}</label>
              <textarea
                className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
                value={JSON.stringify(form.args, null, 2)}
                onChange={(e) => {
                  try {
                    const a = JSON.parse(e.target.value) as string[];
                    if (Array.isArray(a)) setForm((f) => ({ ...f, args: a }));
                  } catch {
                    /* keep typing */
                  }
                }}
              />
            </>
          )}
          <label className="text-xs text-muted-foreground">{t.mcpEnvJson}</label>
          <textarea
            className="w-full min-h-[56px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
            value={JSON.stringify(form.env, null, 2)}
            onChange={(e) => {
              try {
                const o = JSON.parse(e.target.value) as Record<string, string>;
                if (o && typeof o === "object") setForm((f) => ({ ...f, env: o }));
              } catch {
                /* keep typing */
              }
            }}
          />
          <button
            type="button"
            disabled={saving}
            onClick={saveNew}
            className="self-start inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t.mcpSave}
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t.mcpImportSection}</h2>
        <p className="text-xs text-muted-foreground">{t.mcpImportHint}</p>
        <textarea
          className="w-full min-h-[120px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
          value={importText}
          placeholder='{ "mcpServers": { ... } }'
          onChange={(e) => setImportText(e.target.value)}
        />
        <button
          type="button"
          disabled={saving || !importText.trim()}
          onClick={doImport}
          className="text-sm rounded-md border border-border px-3 py-1.5 hover:bg-muted disabled:opacity-50"
        >
          {t.mcpImportButton}
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">{t.mcpInstalled}</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t.loading}
          </p>
        ) : servers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.mcpEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {servers.map((s) => {
              const isSse = (s.transport || "stdio") === "sse";
              const cmdLine = isSse
                ? s.url || "(no URL)"
                : [s.command, ...s.args].filter(Boolean).join(" ");
              const expanded = expandedServerId === s.id;
              const tools = serverTools[s.id] ?? [];
              const showAll = showAllToolsFor[s.id];
              const preview = showAll ? tools : tools.slice(0, TOOL_CHIP_PREVIEW);
              const hasMore = tools.length > TOOL_CHIP_PREVIEW;
              return (
                <li
                  key={s.id}
                  className="rounded-lg border border-border bg-card text-sm overflow-hidden"
                >
                  <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      className="p-0.5 rounded text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
                      onClick={() => toggleExpandServer(s.id)}
                      title={t.mcpToggleToolsList}
                      aria-expanded={expanded}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full shrink-0",
                        s.last_error
                          ? "bg-amber-500"
                          : s.tool_count != null && s.tool_count > 0
                            ? "bg-emerald-500"
                            : "bg-muted-foreground/40"
                      )}
                    />
                    <button
                      type="button"
                      className="font-mono font-medium text-left hover:underline"
                      onClick={() => toggleExpandServer(s.id)}
                    >
                      {s.id}
                    </button>
                    <span className="text-xs text-muted-foreground truncate max-w-[220px] min-w-0">
                      {cmdLine}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {s.tool_count != null ? `${s.tool_count} tools` : "—"}
                    </span>
                    <label
                      className="ml-auto flex items-center gap-1.5 text-xs cursor-pointer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={() => toggle(s)}
                      />
                      {t.mcpEnabled}
                    </label>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                      disabled={testing === s.id}
                      onClick={() => test(s.id)}
                    >
                      {testing === s.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <FlaskConical className="h-3.5 w-3.5" />
                      )}
                      {t.mcpTest}
                    </button>
                    <button
                      type="button"
                      className="p-1.5 text-muted-foreground hover:text-destructive rounded"
                      onClick={() => remove(s.id)}
                      title={t.mcpDeleteConfirm}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {expanded && (
                    <div className="border-t border-border bg-muted/20 px-3 py-3 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-medium text-muted-foreground">
                          {t.mcpToolsHeading}
                        </span>
                        <button
                          type="button"
                          disabled={loadingToolsId === s.id}
                          className="inline-flex items-center gap-1 text-xs rounded-md border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
                          onClick={() => loadToolsFor(s.id, true)}
                        >
                          {loadingToolsId === s.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                          {t.mcpToolsRefresh}
                        </button>
                      </div>
                      {toolsErrById[s.id] && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">{toolsErrById[s.id]}</p>
                      )}
                      {loadingToolsId === s.id && tools.length === 0 ? (
                        <p className="text-xs text-muted-foreground flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.loading}
                        </p>
                      ) : tools.length === 0 ? (
                        <p className="text-xs text-muted-foreground">{t.mcpToolsEmpty}</p>
                      ) : (
                        <>
                          <div className="flex flex-wrap gap-1.5">
                            {preview.map((tool) => (
                              <span
                                key={tool.name}
                                title={
                                  tool.description
                                    ? `${tool.name}\n${tool.description}`
                                    : tool.name
                                }
                                className="inline-flex max-w-[min(100%,220px)] truncate rounded-md border border-border bg-background/80 px-2 py-0.5 text-xs font-mono text-foreground/90"
                              >
                                {tool.name}
                              </span>
                            ))}
                          </div>
                          {hasMore && (
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline"
                              onClick={() =>
                                setShowAllToolsFor((prev) => ({
                                  ...prev,
                                  [s.id]: !showAll,
                                }))
                              }
                            >
                              {showAll ? t.mcpToolsShowLess : t.mcpToolsShowMore}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
