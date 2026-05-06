import { useEffect, useRef, useState, useMemo, useCallback, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Send, Loader2, ArrowDown, CheckCircle2, Square, Download, Plus, Paperclip, X, Users, ImagePlus, User } from "lucide-react";
import { toast } from "sonner";
import { useAgentStore } from "@/stores/agent";
import { useSSE } from "@/hooks/useSSE";
import { useI18n } from "@/lib/i18n";
import { api, type OpenAIUserContentPart } from "@/lib/api";
import { fileToImageDataUrl } from "@/lib/imageCompress";
import { formatDateShanghaiForFilename, formatDateTimeShanghai } from "@/lib/shanghaiTime";
import type { AgentMessage, ToolCallEntry } from "@/types/agent";
import { AgentAvatar } from "@/components/chat/AgentAvatar";
import { WelcomeScreen } from "@/components/chat/WelcomeScreen";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { ThinkingTimeline } from "@/components/chat/ThinkingTimeline";
import { ConversationTimeline } from "@/components/chat/ConversationTimeline";
import { SwarmDashboard, type SwarmAgent, type SwarmDashboardProps } from "@/components/chat/SwarmDashboard";

/* ---------- Message grouping ---------- */
type MsgGroup =
  | { kind: "single"; msg: AgentMessage }
  | { kind: "timeline"; msgs: AgentMessage[] };

function groupMessages(msgs: AgentMessage[]): MsgGroup[] {
  const out: MsgGroup[] = [];
  let buf: AgentMessage[] = [];
  const flush = () => { if (buf.length) { out.push({ kind: "timeline", msgs: [...buf] }); buf = []; } };
  for (const m of msgs) {
    if (["thinking", "tool_call", "tool_result", "compact"].includes(m.type)) {
      buf.push(m);
    } else {
      flush();
      out.push({ kind: "single", msg: m });
    }
  }
  flush();
  return out;
}

const act = () => useAgentStore.getState();

const MAX_CHAT_IMAGES = 5;

/** 部分系统/浏览器下本地文件 `type` 为空，仅靠 `image/*` 会筛掉所有文件导致无缩略图 */
const IMAGE_FILE_NAME_RE = /\.(png|jpe?g|gif|webp|bmp|heic|heif|tiff?|svg)$/i;

function isImageFile(file: File): boolean {
  const t = (file.type ?? "").toLowerCase();
  if (t.startsWith("image/")) return true;
  return IMAGE_FILE_NAME_RE.test(file.name);
}

function extractImageUrlsFromMetadata(meta: Record<string, unknown> | undefined): string[] | undefined {
  const uc = meta?.user_content;
  if (!Array.isArray(uc)) return undefined;
  const urls: string[] = [];
  for (const p of uc) {
    if (p && typeof p === "object" && (p as { type?: string }).type === "image_url") {
      const url = (p as { image_url?: { url?: string } }).image_url?.url;
      if (url) urls.push(url);
    }
  }
  return urls.length ? urls : undefined;
}

/* ---------- Component ---------- */
export function Agent() {
  const [input, setInput] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sseSessionRef = useRef<string | null>(null);
  const prevSseStatusRef = useRef<string>("disconnected");
  const genRef = useRef(0);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const lastEventRef = useRef(0);

  const [attachment, setAttachment] = useState<{
    filename: string;
    filePath: string;
    /** 上传前生成的预览（仅图片类文件） */
    previewDataUrl?: string;
  } | null>(null);
  const [pendingImages, setPendingImages] = useState<Array<{ id: string; dataUrl: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [showUploadMenu, setShowUploadMenu] = useState(false);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [swarmPreset, setSwarmPreset] = useState<{ name: string; title: string } | null>(null);
  const swarmCancelRef = useRef(false);
  const [swarmDash, setSwarmDash] = useState<SwarmDashboardProps | null>(null);
  const swarmDashRef = useRef<SwarmDashboardProps | null>(null);

  const messages = useAgentStore(s => s.messages);
  const streamingText = useAgentStore(s => s.streamingText);
  const status = useAgentStore(s => s.status);
  const sessionId = useAgentStore(s => s.sessionId);
  const toolCalls = useAgentStore(s => s.toolCalls);
  const sessionLoading = useAgentStore(s => s.sessionLoading);

  const { connect, disconnect, onStatusChange } = useSSE();
  const { t } = useI18n();

  const urlSessionId = searchParams.get("session");

  /* Smart scroll — only auto-scroll when near bottom */
  const isNearBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 100;
  }, []);

  const rafRef = useRef(0);
  const scrollToBottom = useCallback(() => {
    if (!isNearBottom()) {
      setShowScrollBtn(true);
      return;
    }
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, [isNearBottom]);

  const forceScrollToBottom = useCallback(() => {
    setShowScrollBtn(false);
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    });
  }, []);

  /* Track scroll position to show/hide scroll button */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isNearBottom()) setShowScrollBtn(false);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [isNearBottom]);

  useEffect(() => {
    onStatusChange((s) => {
      act().setSseStatus(s);
      if (s === "reconnecting" && prevSseStatusRef.current === "connected") toast.warning(t.reconnecting);
      else if (s === "connected" && prevSseStatusRef.current === "reconnecting") toast.success(t.connected);
      prevSseStatusRef.current = s;
    });
  }, [onStatusChange, t]);

  const doDisconnect = useCallback(() => {
    disconnect();
    sseSessionRef.current = null;
  }, [disconnect]);

  const loadSessionMessages = useCallback(async (sid: string, gen: number) => {
    try {
      const msgs = await api.getSessionMessages(sid);
      if (genRef.current !== gen) return;
      const agentMsgs: AgentMessage[] = [];
      for (const m of msgs) {
        const meta = m.metadata as Record<string, unknown> | undefined;
        const runId = meta?.run_id as string | undefined;
        const metrics = meta?.metrics as Record<string, number> | undefined;
        const ts = new Date(m.created_at).getTime();
        if (m.role === "user") {
          const imageUrls = extractImageUrlsFromMetadata(m.metadata as Record<string, unknown> | undefined);
          agentMsgs.push({
            id: m.message_id,
            type: "user",
            content: m.content,
            timestamp: ts,
            ...(imageUrls ? { imageUrls } : {}),
          });
        } else if (runId) {
          // Show text answer first (if non-empty), then chart card
          if (m.content && m.content !== "Strategy execution completed.") {
            agentMsgs.push({
              id: m.message_id + "_ans",
              type: "answer",
              content: m.content,
              timestamp: ts,
              runId,
            });
          }
          agentMsgs.push({ id: m.message_id, type: "run_complete", content: "", runId, metrics, timestamp: ts + 1 });
        } else {
          agentMsgs.push({ id: m.message_id, type: "answer", content: m.content, timestamp: ts });
        }
      }
      if (genRef.current !== gen) return;
      act().loadHistory(agentMsgs);
      act().setSessionLoading(false);
      act().cacheSession(sid, agentMsgs);
      setTimeout(() => forceScrollToBottom(), 50);
    } catch {
      act().setSessionLoading(false);
    }
  }, [forceScrollToBottom]);

  const setupSSE = useCallback((sid: string) => {
    if (sseSessionRef.current === sid) return;
    disconnect();
    sseSessionRef.current = sid;

    const touch = () => { lastEventRef.current = Date.now(); };

    connect(api.sseUrl(sid), {
      text_delta: (d) => { touch(); act().appendDelta(String(d.delta || "")); scrollToBottom(); },
      thinking_done: () => { touch(); /* don't flush — keep streaming text visible */ },

      tool_call: (d) => {
        touch();
        const toolName = String(d.tool || "");
        // Only update toolCalls tracker (no message creation during streaming)
        act().addToolCall({
          id: toolName, tool: toolName,
          arguments: (d.arguments as Record<string, string>) ?? {},
          status: "running", timestamp: Date.now(),
        });
        scrollToBottom();
      },

      tool_result: (d) => {
        touch();
        // Only update tracker (no message creation during streaming)
        act().updateToolCall(String(d.tool || ""), {
          status: d.status === "ok" ? "ok" : "error",
          preview: String(d.preview || ""),
          elapsed_ms: Number(d.elapsed_ms || 0),
        });
      },

      compact: () => { touch(); },

      "attempt.completed": async (d) => {
        touch();
        const s = act();
        // Build ThinkingTimeline summary from accumulated toolCalls
        const completedTools = s.toolCalls;
        if (completedTools.length > 0) {
          const totalMs = completedTools.reduce((a, tc) => a + (tc.elapsed_ms || 0), 0);
          for (const tc of completedTools) {
            s.addMessage({ id: tc.id + "_call", type: "tool_call", content: "", tool: tc.tool, args: tc.arguments, status: tc.status || "ok", timestamp: tc.timestamp });
            if (tc.elapsed_ms != null) {
              s.addMessage({ id: "", type: "tool_result", content: tc.preview || "", tool: tc.tool, status: tc.status || "ok", elapsed_ms: tc.elapsed_ms, timestamp: tc.timestamp + 1 });
            }
          }
        }

        // Clear streaming text (don't create thinking message)
        s.clearStreaming();

        // Add final answer
        const runDir = String(d.run_dir || "");
        const runId = runDir ? runDir.split(/[/\\]/).pop() : undefined;
        const summary = String(d.summary || "");
        if (summary) {
          s.addMessage({
            id: "",
            type: "answer",
            content: summary,
            timestamp: Date.now(),
            runId: runId || undefined,
          });
        }

        // Detect Shadow Account id if render_shadow_report fired successfully this turn
        const shadowCall = completedTools.find(
          (tc) => tc.tool === "render_shadow_report" && (tc.status || "ok") === "ok",
        );
        const shadowMatch = shadowCall?.preview?.match(/"shadow_id"\s*:\s*"(shadow_[A-Za-z0-9_]+)"/);
        const shadowId = shadowMatch?.[1];

        // Show RunCompleteCard when the turn produced backtest metrics or a shadow report
        if (runId) {
          try {
            const runData = await api.getRun(runId);
            const hasMetrics = runData.metrics && Object.keys(runData.metrics).length > 0;
            if (hasMetrics || shadowId) {
              s.addMessage({
                id: "", type: "run_complete", content: "", runId,
                metrics: hasMetrics ? runData.metrics : undefined,
                equityCurve: runData.equity_curve?.map(e => ({ time: e.time, equity: e.equity })),
                shadowId,
                timestamp: Date.now(),
              });
            }
          } catch { /* ignore */ }
        } else if (shadowId) {
          s.addMessage({ id: "", type: "run_complete", content: "", shadowId, timestamp: Date.now() });
        }

        // Reset
        s.setStatus("idle");
        useAgentStore.setState({ toolCalls: [] });
        scrollToBottom();
      },

      "attempt.failed": (d) => {
        touch();
        act().clearStreaming();
        act().addMessage({ id: "", type: "error", content: String(d.error || "Execution failed"), timestamp: Date.now() });
        act().setStatus("idle");
        scrollToBottom();
      },

      heartbeat: () => {},
      reconnect: (d) => { act().setSseStatus("reconnecting", Number(d.attempt ?? 0)); },
    });
  }, [connect, disconnect, scrollToBottom]);

  useEffect(() => {
    const gen = ++genRef.current;
    const { sessionId: curSid, messages: curMsgs, cacheSession, reset, getCachedSession, switchSession } = act();

    if (urlSessionId && urlSessionId !== curSid) {
      doDisconnect();
      if (curSid && curMsgs.length > 0) cacheSession(curSid, curMsgs);

      // Atomic switch: cache hit = instant, cache miss = show loading skeleton
      const cached = getCachedSession(urlSessionId);
      switchSession(urlSessionId, cached);
      if (cached) {
        setTimeout(() => forceScrollToBottom(), 50);
      } else {
        loadSessionMessages(urlSessionId, gen);
      }
      setupSSE(urlSessionId);
    } else if (!urlSessionId && curSid) {
      doDisconnect();
      if (curMsgs.length > 0) cacheSession(curSid, curMsgs);
      reset();
    }
  }, [urlSessionId, doDisconnect, loadSessionMessages, setupSSE, forceScrollToBottom]);

  useEffect(() => () => doDisconnect(), [doDisconnect]);

  /* Safety timeout: if streaming but no SSE event for 6 minutes, reset to idle */
  useEffect(() => {
    if (status !== "streaming") return;
    const timer = setInterval(() => {
      if (lastEventRef.current && Date.now() - lastEventRef.current > 360_000 && act().status === "streaming") {
        act().setStatus("idle");
        toast.warning("Execution timed out, automatically stopped");
      }
    }, 10_000);
    return () => clearInterval(timer);
  }, [status]);

  const runSwarm = async (presetName: string, presetTitle: string, prompt: string) => {
    let sid = act().sessionId;
    if (!sid) {
      try {
        const session = await api.createSession(`[Swarm] ${presetTitle}: ${prompt.slice(0, 30)}`);
        sid = session.session_id;
        act().setSessionId(sid);
        setSearchParams({ session: sid }, { replace: true });
      } catch { /* continue without session */ }
    }

    act().addMessage({ id: "", type: "user", content: `[${presetTitle}] ${prompt}`, timestamp: Date.now() });
    act().setStatus("streaming");
    // Add a placeholder swarm-progress message (rendered as SwarmDashboard)
    act().addMessage({ id: "swarm-progress", type: "answer", content: "", timestamp: Date.now() });
    forceScrollToBottom();
    swarmCancelRef.current = false;

    // Initialize dashboard state
    const dash: SwarmDashboardProps = {
      preset: presetTitle,
      agents: {},
      agentOrder: [],
      currentLayer: 0,
      finished: false,
      finalStatus: "",
      startTime: Date.now(),
      completedSummaries: [],
      finalReport: "",
    };
    swarmDashRef.current = dash;
    setSwarmDash({ ...dash });

    const ensureAgent = (agentId: string): SwarmAgent => {
      if (!dash.agents[agentId]) {
        dash.agents[agentId] = {
          id: agentId, status: "waiting", tool: "", iters: 0,
          startedAt: 0, elapsed: 0, lastText: "", summary: "",
        };
        dash.agentOrder.push(agentId);
      }
      return dash.agents[agentId];
    };

    const flush = () => { lastEventRef.current = Date.now(); swarmDashRef.current = dash; setSwarmDash({ ...dash }); scrollToBottom(); };

    try {
      const result = await api.createSwarmRun(presetName, { goal: prompt });
      const runId = result.id;
      const sseUrl = api.swarmSseUrl(runId);
      const evtSource = new EventSource(sseUrl);
      let sseFinished = false;

      evtSource.addEventListener("layer_started", (e) => {
        try {
          const d = JSON.parse(e.data);
          dash.currentLayer = d.data?.layer ?? 0;
          flush();
        } catch {}
      });

      evtSource.addEventListener("task_started", (e) => {
        try {
          const d = JSON.parse(e.data);
          const agentId = d.agent_id || "";
          if (agentId) {
            const a = ensureAgent(agentId);
            a.status = "running";
            a.startedAt = Date.now();
            flush();
          }
        } catch {}
      });

      evtSource.addEventListener("worker_text", (e) => {
        try {
          const d = JSON.parse(e.data);
          const agentId = d.agent_id || "";
          const content = (d.data?.content || "").trim();
          if (agentId && content) {
            const a = ensureAgent(agentId);
            const lastLine = content.split("\n").pop()?.trim() || "";
            if (lastLine) a.lastText = lastLine.slice(0, 60);
            flush();
          }
        } catch {}
      });

      evtSource.addEventListener("tool_call", (e) => {
        try {
          const d = JSON.parse(e.data);
          const agentId = d.agent_id || "";
          const tool = d.data?.tool || "";
          if (agentId && tool) {
            const a = ensureAgent(agentId);
            a.tool = tool;
            a.iters++;
            flush();
          }
        } catch {}
      });

      evtSource.addEventListener("tool_result", (e) => {
        try {
          const d = JSON.parse(e.data);
          const agentId = d.agent_id || "";
          if (agentId) {
            const a = ensureAgent(agentId);
            const ok = (d.data?.status || "ok") === "ok";
            a.tool = `${a.tool} ${ok ? "\u2713" : "\u2717"}`;
            a.elapsed = a.startedAt ? Date.now() - a.startedAt : 0;
            flush();
          }
        } catch {}
      });

      evtSource.addEventListener("task_completed", (e) => {
        try {
          const d = JSON.parse(e.data);
          const agentId = d.agent_id || "";
          if (agentId) {
            const a = ensureAgent(agentId);
            a.status = "done";
            a.elapsed = a.startedAt ? Date.now() - a.startedAt : 0;
            a.iters = d.data?.iterations ?? a.iters;
            const summary = d.data?.summary || "";
            if (summary) {
              a.summary = summary;
              dash.completedSummaries.push({ agentId, summary });
            }
            flush();
          }
        } catch {}
      });

      evtSource.addEventListener("task_failed", (e) => {
        try {
          const d = JSON.parse(e.data);
          const agentId = d.agent_id || "";
          if (agentId) {
            const a = ensureAgent(agentId);
            a.status = "failed";
            a.elapsed = a.startedAt ? Date.now() - a.startedAt : 0;
            const error = (d.data?.error || "").slice(0, 80);
            dash.completedSummaries.push({ agentId, summary: `FAILED: ${error}` });
            flush();
          }
        } catch {}
      });

      evtSource.addEventListener("task_retry", (e) => {
        try {
          const d = JSON.parse(e.data);
          const agentId = d.agent_id || "";
          if (agentId) { ensureAgent(agentId).status = "retry"; flush(); }
        } catch {}
      });

      evtSource.addEventListener("done", () => { sseFinished = true; evtSource.close(); });
      evtSource.onerror = () => { if (!sseFinished) evtSource.close(); };

      // Poll for completion
      for (let i = 0; i < 720; i++) {
        await new Promise(r => setTimeout(r, 2500));
        if (swarmCancelRef.current) { evtSource.close(); break; }
        try {
          const run = await api.getSwarmRun(runId);
          const rs = String(run.status || "");
          if (["completed", "failed", "cancelled"].includes(rs)) {
            evtSource.close();
            dash.finished = true;
            dash.finalStatus = rs;
            const report = String(run.final_report || "");
            if (!report) {
              const tasks = (run.tasks || []) as Array<{ agent_id: string; summary?: string }>;
              dash.finalReport = tasks
                .filter(t => t.summary && !t.summary.startsWith("Worker hit iteration limit"))
                .map(t => `### ${t.agent_id}\n${t.summary}`)
                .join("\n\n") || "Swarm completed.";
            } else {
              dash.finalReport = report;
            }
            flush();
            act().setStatus("idle");
            return;
          }
        } catch {}
      }
      evtSource.close();
      act().addMessage({ id: "", type: "error", content: "Swarm timed out", timestamp: Date.now() });
      act().setStatus("idle");
    } catch (err) {
      act().setStatus("error");
      act().addMessage({ id: "", type: "error", content: `Swarm failed: ${err instanceof Error ? err.message : "Unknown"}`, timestamp: Date.now() });
    }
  };

  const runPrompt = async (overrideText?: string, retryImageUrls?: string[]) => {
    if (status === "streaming") return;

    const cmdOnly = (overrideText ?? input).trim();
    if (/^\/new$/i.test(cmdOnly) || /^\/新会话$/i.test(cmdOnly)) {
      toast.info(t.webNoNewCommand);
      return;
    }

    let finalPrompt = (overrideText ?? input).trim();

    // Swarm mode: let agent auto-select the right preset
    if (swarmPreset) {
      setSwarmPreset(null);
      finalPrompt = `[Swarm Team Mode] Use the swarm tool to assemble the best specialist team for this task. Auto-select the most appropriate preset.\n\n${finalPrompt}`;
    }

    const extraImageUrls: string[] = [];
    if (attachment) {
      if (attachment.previewDataUrl) {
        extraImageUrls.push(attachment.previewDataUrl);
      } else {
        finalPrompt = `[Uploaded file: ${attachment.filename}, path: ${attachment.filePath}]\n\n${finalPrompt}`;
      }
      setAttachment(null);
    }

    const imageUrls = [
      ...extraImageUrls,
      ...(retryImageUrls ?? pendingImages.map((p) => p.dataUrl)),
    ];
    if (!finalPrompt.trim() && imageUrls.length === 0) return;

    const visionDefaultText =
      finalPrompt.trim() ||
      (imageUrls.length > 1 ? "请依次理解以下图片并回答。" : "请理解图片内容并回答。");

    setInput("");
    setPendingImages([]);
    act().addMessage({
      id: "",
      type: "user",
      content: finalPrompt.trim() || visionDefaultText,
      ...(imageUrls.length ? { imageUrls } : {}),
      timestamp: Date.now(),
    });
    act().setStatus("streaming");
    forceScrollToBottom();
    inputRef.current?.focus();

    let payload: string | OpenAIUserContentPart[];
    if (imageUrls.length > 0) {
      const parts: OpenAIUserContentPart[] = [];
      // 纯图无字时也必须带 text，否则部分模型/网关对「仅 image_url parts」不触发正常补全
      parts.push({ type: "text", text: visionDefaultText });
      for (const url of imageUrls) {
        parts.push({ type: "image_url", image_url: { url } });
      }
      payload = parts;
    } else {
      payload = finalPrompt;
    }

    try {
      let sid = act().sessionId;
      const titleHint = finalPrompt.slice(0, 50) || "图片对话";
      if (!sid) {
        const session = await api.createSession(titleHint);
        sid = session.session_id;
        act().setSessionId(sid);
        setSearchParams({ session: sid }, { replace: true });
      }
      setupSSE(sid);
      await api.sendMessage(sid, payload);
    } catch (err) {
      act().setStatus("error");
      const detail = err instanceof Error ? err.message : String(err);
      toast.error(`${t.sendFailed}${detail ? `: ${detail}` : ""}`);
      act().addMessage({
        id: "",
        type: "error",
        content: `${t.sendFailed}${detail ? `: ${detail}` : ""}`,
        timestamp: Date.now(),
      });
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    runPrompt();
  };

  const handleCancel = async () => {
    swarmCancelRef.current = true;
    if (!sessionId) {
      act().setStatus("idle");
      return;
    }
    try {
      await api.cancelSession(sessionId);
      act().setStatus("idle");
      act().clearStreaming();
      useAgentStore.setState({ toolCalls: [] });
      toast.info("Cancel request sent");
    } catch {
      toast.error("Cancel failed");
    }
  };

  const handleRetry = useCallback((errorMsg: AgentMessage) => {
    if (status === "streaming") return;
    const msgs = act().messages;
    const errorIdx = msgs.findIndex(m => m.id === errorMsg.id);
    if (errorIdx === -1) return;
    let userText = "";
    let retryImages: string[] | undefined;
    for (let i = errorIdx - 1; i >= 0; i--) {
      if (msgs[i].type === "user") {
        userText = msgs[i].content;
        retryImages = msgs[i].imageUrls;
        break;
      }
    }
    if (!userText.trim() && !retryImages?.length) return;
    runPrompt(userText, retryImages);
  }, [status]);

  const handleExport = () => {
    if (messages.length === 0) return;
    const lines: string[] = [`# Chat Export`, ``, `Export time: ${formatDateTimeShanghai(Date.now())} (Asia/Shanghai)`, ``];
    for (const msg of messages) {
      const time = formatDateTimeShanghai(msg.timestamp);
      if (msg.type === "user") {
        lines.push(`## User (${time})`, ``, msg.content, ``);
      } else if (msg.type === "answer") {
        lines.push(`## Assistant (${time})`, ``, msg.content, ``);
      } else if (msg.type === "error") {
        lines.push(`## Error (${time})`, ``, msg.content, ``);
      } else if (msg.type === "tool_call") {
        lines.push(`> Tool call: ${msg.tool || "unknown"}`, ``);
      } else if (msg.type === "run_complete") {
        lines.push(`> Backtest complete: ${msg.runId || ""}`, ``);
      }
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat_${formatDateShanghaiForFilename()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const blockedExts = [
      ".exe", ".msi", ".bat", ".cmd", ".com", ".scr", ".app", ".dmg",
      ".so", ".dll", ".dylib",
      ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz",
    ];
    const lowered = file.name.toLowerCase();
    if (blockedExts.some((ext) => lowered.endsWith(ext))) {
      toast.error("Executables and archives are not allowed");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("File size exceeds 50 MB limit");
      return;
    }
    setUploading(true);
    setShowUploadMenu(false);
    let previewDataUrl: string | undefined;
    if (isImageFile(file)) {
      try {
        previewDataUrl = await fileToImageDataUrl(file);
      } catch {
        /* 预览失败仍继续上传 */
      }
    }
    try {
      const result = await api.uploadFile(file);
      setAttachment({
        filename: result.filename,
        filePath: result.file_path,
        ...(previewDataUrl ? { previewDataUrl } : {}),
      });
      toast.success(`Uploaded: ${result.filename}`);
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setUploading(false);
    }
  }, []);

  const handleImageSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    e.target.value = "";
    const list = Array.from(files).filter(isImageFile);
    if (list.length < files.length) toast.error("已跳过非图片文件");
    const newItems: Array<{ id: string; dataUrl: string }> = [];
    for (const file of list) {
      if (file.size > 25 * 1024 * 1024) {
        toast.error("单张图片请小于 25MB");
        continue;
      }
      try {
        const dataUrl = await fileToImageDataUrl(file);
        newItems.push({ id: `${Date.now()}-${newItems.length}`, dataUrl });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "图片处理失败");
      }
    }
    if (!newItems.length) return;
    setPendingImages((prev) => {
      const merged = [...prev, ...newItems].slice(0, MAX_CHAT_IMAGES);
      if (prev.length + newItems.length > MAX_CHAT_IMAGES) {
        toast.error(`最多 ${MAX_CHAT_IMAGES} 张图片`);
      }
      return merged;
    });
  }, []);

  const removePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((p) => p.id !== id));
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (uploadMenuRef.current && !uploadMenuRef.current.contains(e.target as Node)) {
        setShowUploadMenu(false);
      }
    };
    if (showUploadMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showUploadMenu]);

  const showComposeDraft =
    pendingImages.length > 0 || !!attachment?.previewDataUrl;

  useEffect(() => {
    if (!showComposeDraft) return;
    const id = requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(id);
  }, [showComposeDraft, pendingImages, attachment?.previewDataUrl]);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden h-full">
      <div ref={listRef} className="flex-1 overflow-auto p-6 scroll-smooth relative">
        <div className="max-w-3xl mx-auto space-y-4">
          {sessionLoading && (
            <div className="space-y-4 py-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted/60 rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!sessionLoading && messages.length === 0 && !showComposeDraft && (
            <WelcomeScreen onExample={runPrompt} />
          )}

          {groups.map((g, i) => {
            if (g.kind === "timeline") {
              return (
                <ThinkingTimeline
                  key={g.msgs[0].id || g.msgs[0].timestamp}
                  messages={g.msgs}
                  isLatest={i === groups.length - 1 && status === "streaming"}
                />
              );
            }
            const msgIdx = messages.indexOf(g.msg);
            // Render swarm-progress as SwarmDashboard
            if (g.msg.id === "swarm-progress" && swarmDash) {
              return (
                <div key="swarm-dash" className="flex gap-3">
                  <AgentAvatar />
                  <div className="flex-1 min-w-0">
                    <SwarmDashboard {...swarmDash} />
                  </div>
                </div>
              );
            }
            return (
              <div key={g.msg.id || g.msg.timestamp} data-msg-idx={msgIdx}>
                <MessageBubble msg={g.msg} onRetry={g.msg.type === "error" ? handleRetry : undefined} />
              </div>
            );
          })}

          {showComposeDraft && (
            <div className="flex justify-end gap-3">
              <div className="max-w-[min(100%,36rem)] w-full rounded-2xl rounded-tr-sm border border-dashed border-primary/35 bg-muted/15 px-4 py-3 text-sm">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  待发送
                </div>
                <div className="space-y-3">
                  {attachment?.previewDataUrl && (
                    <div className="relative group/draftimg">
                      <img
                        src={attachment.previewDataUrl}
                        alt=""
                        className="w-full max-h-[min(70vh,720px)] object-contain rounded-lg border border-border/80 bg-background/50"
                      />
                      <button
                        type="button"
                        onClick={() => setAttachment(null)}
                        className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-background/90 border border-border text-muted-foreground hover:text-destructive flex items-center justify-center shadow-sm"
                        title="移除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  {pendingImages.map((p) => (
                    <div key={p.id} className="relative group/draftimg">
                      <img
                        src={p.dataUrl}
                        alt=""
                        className="w-full max-h-[min(70vh,720px)] object-contain rounded-lg border border-border/80 bg-background/50"
                      />
                      <button
                        type="button"
                        onClick={() => removePendingImage(p.id)}
                        className="absolute top-1.5 right-1.5 h-7 w-7 rounded-full bg-background/90 border border-border text-muted-foreground hover:text-destructive flex items-center justify-center shadow-sm"
                        title="移除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                {input.trim() ? (
                  <div className="mt-3 pt-3 border-t border-border/60 text-foreground whitespace-pre-wrap leading-relaxed">
                    {input}
                  </div>
                ) : null}
              </div>
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                <User className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          )}

          {/* Live streaming area: text + tool status */}
          {(streamingText || (status === "streaming" && toolCalls.length > 0)) && (
            <div className="flex gap-3">
              <AgentAvatar />
              <div className="flex-1 min-w-0 space-y-1.5">
                {streamingText && (
                  <div className="prose prose-sm dark:prose-invert max-w-none leading-relaxed">
                    {streamingText}
                    <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle" />
                  </div>
                )}
                {status === "streaming" && toolCalls.length > 0 && (() => {
                  const latest = toolCalls[toolCalls.length - 1];
                  const running = latest.status === "running";
                  return (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {running
                        ? <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
                        : <CheckCircle2 className="h-3 w-3 text-success/60 shrink-0" />}
                      <span>Step {toolCalls.length} · {latest.tool}</span>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

        </div>

        {/* Scroll to bottom button */}
        {showScrollBtn && (
          <button
            onClick={forceScrollToBottom}
            className="sticky bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:opacity-90 transition-opacity z-10"
          >
            <ArrowDown className="h-3 w-3" /> New messages
          </button>
        )}
        <ConversationTimeline messages={messages} containerRef={listRef} />
      </div>

      <form onSubmit={handleSubmit} className="border-t p-4 bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto space-y-2">
          {/* Swarm preset badge */}
          {swarmPreset && (
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-medium">
                <Users className="h-3 w-3" />
                {swarmPreset.title}
                <button type="button" onClick={() => setSwarmPreset(null)} className="hover:text-destructive transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          )}
          {/* 非图片附件：仅显示文件名；图片在上方对话区展示 */}
          {attachment && !attachment.previewDataUrl && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/10 text-primary text-xs font-medium">
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[200px]">{attachment.filename}</span>
                <button type="button" onClick={() => setAttachment(null)} className="hover:text-destructive transition-colors shrink-0">
                  <X className="h-3 w-3" />
                </button>
              </span>
            </div>
          )}
          {/* Uploading indicator */}
          {uploading && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Uploading...
            </div>
          )}
          <div className="flex gap-2 items-end">
            {/* "+" menu: PDF upload + Swarm presets */}
            <div className="relative" ref={uploadMenuRef}>
              <button
                type="button"
                onClick={() => setShowUploadMenu(prev => !prev)}
                disabled={status === "streaming" || uploading}
                className="w-9 h-9 rounded-full border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40 shrink-0"
                title="More options"
              >
                <Plus className="h-4 w-4" />
              </button>
              {showUploadMenu && (
                <div className="absolute bottom-full left-0 mb-2 w-56 rounded-xl border bg-background/95 backdrop-blur-sm shadow-lg py-1 z-50">
                  <button
                    type="button"
                    onClick={() => { fileInputRef.current?.click(); setShowUploadMenu(false); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <Paperclip className="h-4 w-4" />
                    Upload PDF document
                  </button>
                  <button
                    type="button"
                    onClick={() => { imageInputRef.current?.click(); setShowUploadMenu(false); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <ImagePlus className="h-4 w-4" />
                    添加图片（模型识图）
                  </button>
                  <div className="border-t my-1" />
                  <button
                    type="button"
                    onClick={() => {
                      setShowUploadMenu(false);
                      setSwarmPreset({ name: "auto", title: "Agent Swarm" });
                      inputRef.current?.focus();
                    }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted transition-colors flex items-center gap-2"
                  >
                    <Users className="h-4 w-4" />
                    Agent Swarm
                  </button>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.xlsx,.xls,.pptx,.csv,.tsv,.txt,.md,.log,.json,.yaml,.yml,.toml,.html,.xml,.rst,.png,.jpg,.jpeg,.gif,.bmp,.webp,.tiff"
              onChange={handleFileSelect}
              className="hidden"
            />
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              className="hidden"
            />
            <textarea
              ref={inputRef}
              value={input}
              rows={1}
              onChange={(e) => setInput(e.target.value)}
              onInput={(e) => {
                const el = e.target as HTMLTextAreaElement;
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runPrompt();
                }
              }}
              placeholder={t.prompt}
              className="flex-1 px-4 py-2.5 rounded-xl border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition-shadow resize-none max-h-32 overflow-y-auto"
              disabled={status === "streaming"}
            />
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleExport}
                className="px-3 py-2.5 rounded-xl border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Export chat"
              >
                <Download className="h-4 w-4" />
              </button>
            )}
            {status === "streaming" ? (
              <button
                type="button"
                onClick={handleCancel}
                className="px-4 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                title="Stop generation"
              >
                <Square className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={
                  !input.trim() &&
                  !attachment &&
                  pendingImages.length === 0
                }
                className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                <Send className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
