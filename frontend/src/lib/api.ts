const BASE = "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : ({} as T);
}

export interface UploadResult {
  status: string;
  file_path: string;
  filename: string;
}

async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/upload`, { method: "POST", body: form });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  uploadFile,
  listRuns: () => request<RunListItem[]>("/runs"),
  getRun: (id: string) => request<RunData>(`/runs/${id}`),
  getRunCode: (id: string) => request<Record<string, string>>(`/runs/${id}/code`),
  getRunPine: (id: string) => request<PineScriptResult>(`/runs/${id}/pine`),
  listSessions: () => request<SessionItem[]>("/sessions"),
  createSession: (title?: string) => request<SessionItem>("/sessions", { method: "POST", body: JSON.stringify({ title: title || "" }) }),
  deleteSession: (sid: string) => request<{ status: string }>(`/sessions/${sid}`, { method: "DELETE" }),
  renameSession: (sid: string, title: string) => request<{ status: string }>(`/sessions/${sid}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  sendMessage: (sid: string, content: string) => request<{ message_id: string; attempt_id: string }>(`/sessions/${sid}/messages`, { method: "POST", body: JSON.stringify({ content }) }),
  cancelSession: (sid: string) => request<{ status: string }>(`/sessions/${sid}/cancel`, { method: "POST" }),
  getSessionMessages: (sid: string) => request<MessageItem[]>(`/sessions/${sid}/messages`),
  sseUrl: (sid: string) => `${BASE}/sessions/${sid}/events`,

  // Swarm API
  listSwarmPresets: () => request<SwarmPreset[]>("/swarm/presets"),
  listSwarmZhDocs: () => request<SwarmZhDocInfo[]>("/swarm/zh-docs"),
  getSwarmZhDoc: (stem: string) =>
    request<SwarmZhDocDetail>(`/swarm/zh-docs/${encodeURIComponent(stem)}`),
  createSwarmRun: (preset_name: string, user_vars: Record<string, string>) =>
    request<{ id: string; status: string }>("/swarm/runs", {
      method: "POST",
      body: JSON.stringify({ preset_name, user_vars }),
    }),
  listSwarmRuns: () => request<SwarmRunSummary[]>("/swarm/runs"),
  getSwarmRun: (id: string) => request<Record<string, unknown>>(`/swarm/runs/${id}`),
  cancelSwarmRun: (id: string) =>
    request<{ status: string }>(`/swarm/runs/${id}/cancel`, { method: "POST" }),

  listSkillsCatalog: () => request<SkillCatalogResponse>("/skills/catalog"),
  getSkillDoc: (name: string) =>
    request<SkillDocResponse>(`/skills/${encodeURIComponent(name)}/doc`),

  // MCP servers (Cursor-compatible config)
  listMcpServers: () => request<McpServer[]>("/system/mcp/servers"),
  upsertMcpServer: (id: string, body: McpServerUpsert) =>
    request<McpServer>(`/system/mcp/servers/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  deleteMcpServer: (id: string) =>
    request<{ status: string }>(`/system/mcp/servers/${encodeURIComponent(id)}`, { method: "DELETE" }),
  getMcpServerRaw: (id: string) =>
    request<Record<string, unknown>>(`/system/mcp/servers/${encodeURIComponent(id)}/raw`),
  putMcpServerRaw: (id: string, body: Record<string, unknown>) =>
    request<McpServer>(`/system/mcp/servers/${encodeURIComponent(id)}/raw`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  testMcpServer: (id: string) =>
    request<McpTestResult>(`/system/mcp/servers/${encodeURIComponent(id)}/test`, { method: "POST" }),
  getMcpServerTools: (id: string, refresh?: boolean) =>
    request<McpToolsResponse>(
      `/system/mcp/servers/${encodeURIComponent(id)}/tools${refresh ? "?refresh=true" : ""}`
    ),
  importMcpJson: (raw: Record<string, unknown>) =>
    request<McpImportResult>("/system/mcp/import", {
      method: "POST",
      body: JSON.stringify({ raw }),
    }),
};

// --- MCP types ---

export interface McpServer {
  id: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  transport: string;
  url?: string | null;
  last_error?: string | null;
  tool_count?: number | null;
  tool_names?: string[] | null;
}

export interface McpServerUpsert {
  id: string;
  /** Required for stdio; omit or empty for SSE when ``url`` is set. */
  command?: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  transport?: string;
  url?: string | null;
}

export interface McpImportResult {
  status: string;
  imported: number;
  skipped?: Array<{ id: string; reason: string }>;
}

export interface McpTestResult {
  ok: boolean;
  server_id: string;
  tool_count: number;
  tools: Array<Record<string, unknown>>;
  error?: string | null;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpToolsResponse {
  server_id: string;
  tools: McpToolInfo[];
  tool_count: number;
  source: "cache" | "live";
  error?: string | null;
}

// --- Swarm types ---

export interface SwarmPreset {
  name: string;
  title: string;
  description: string;
  agent_count: number;
  variables: { name: string; description: string; required: boolean }[];
}

export interface SwarmZhDocInfo {
  stem: string;
  title_zh: string;
}

export interface SwarmZhDocDetail {
  stem: string;
  title_zh: string;
  content: string;
}

export interface SwarmRunSummary {
  id: string;
  preset_name: string;
  status: string;
  created_at: string;
  task_count: number;
  completed_count: number;
}

export interface SkillCatalogItem {
  name: string;
  name_zh: string;
  /** 中文一句话简介（侧栏展示） */
  intro_zh: string;
  /** SKILL.md 原始 description，多为英文 */
  description: string;
}

export interface SkillCatalogCategory {
  id: string;
  label_zh: string;
  skills: SkillCatalogItem[];
}

export interface SkillCatalogResponse {
  categories: SkillCatalogCategory[];
}

export interface SkillDocResponse {
  name: string;
  title: string;
  name_zh: string;
  intro_zh: string;
  content: string;
}

// --- Types matching backend API contracts ---

export interface RunListItem {
  run_id: string;
  status: string;
  created_at: string;
  prompt?: string;
  total_return?: number;
  sharpe?: number;
  codes?: string[];
  start_date?: string;
  end_date?: string;
}

export interface PriceBar {
  time: string;
  timestamp?: string;
  code?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeMarker {
  time: string;
  timestamp?: string;
  code?: string;
  side: "BUY" | "SELL";
  price: number;
  qty?: number;
  reason?: string;
  text?: string;
}

export interface EquityPoint {
  time: string;
  equity: string | number;
  drawdown: string | number;
}

export interface ValidationData {
  monte_carlo?: {
    actual_sharpe: number;
    actual_max_dd: number;
    p_value_sharpe: number;
    p_value_max_dd: number;
    simulated_sharpe_mean: number;
    simulated_sharpe_std: number;
    simulated_sharpe_p5: number;
    simulated_sharpe_p95: number;
    n_simulations: number;
    n_trades: number;
    error?: string;
  };
  bootstrap?: {
    observed_sharpe: number;
    ci_lower: number;
    ci_upper: number;
    median_sharpe: number;
    prob_positive: number;
    confidence: number;
    n_bootstrap: number;
    error?: string;
  };
  walk_forward?: {
    n_windows: number;
    windows: Array<{
      window: number;
      start: string;
      end: string;
      return: number;
      sharpe: number;
      max_dd: number;
      trades: number;
      win_rate: number;
    }>;
    profitable_windows: number;
    consistency_rate: number;
    return_mean: number;
    return_std: number;
    sharpe_mean: number;
    sharpe_std: number;
    error?: string;
  };
}

export interface RunData {
  status: string;
  run_id: string;
  prompt?: string;
  elapsed_seconds?: number;
  run_directory?: string;
  run_stage?: string;
  run_context?: Record<string, unknown>;

  metrics?: BacktestMetrics;
  artifacts?: ArtifactInfo[];
  validation?: ValidationData;

  price_series?: Record<string, PriceBar[]>;
  indicator_series?: Record<string, Record<string, IndicatorPoint[]>>;
  trade_markers?: TradeMarker[];
  equity_curve?: EquityPoint[];
  trade_log?: Array<Record<string, string>>;
  run_logs?: Array<{ source?: string; line_number?: number; message?: string }>;
  /** ReAct trace.jsonl spans (sorted by time ascending) */
  agent_trace?: Array<Record<string, unknown>>;
}

export interface BacktestMetrics {
  final_value: number;
  total_return: number;
  annual_return: number;
  max_drawdown: number;
  sharpe: number;
  win_rate: number;
  trade_count: number;
  [key: string]: number;
}


export interface IndicatorPoint {
  time: string;
  value: number;
}

export interface ArtifactInfo {
  name: string;
  path: string;
  type: string;
  size: number;
  exists: boolean;
}

export interface PineScriptResult {
  exists: boolean;
  content: string | null;
}

export interface SessionItem {
  session_id: string;
  title?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  last_attempt_id?: string;
}

export interface MessageItem {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
  linked_attempt_id?: string;
  metadata?: Record<string, unknown>;
}
