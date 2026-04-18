# Vibe-Trading 微信桥（独立进程）

与浏览器 Web UI **并行**：微信消息走本桥 → `vibe-trading serve` 的 Session / Agent（HTTP + SSE），**不**托管前端静态资源。

本目录位于 `Vibe-Trading/wechat-bridge/`；依赖仓库根目录下的 `wechatbot/nodejs` SDK。

## 前置

1. 已安装 **Node.js ≥ 22**。
2. 先构建本地 SDK（仅首次或 SDK 更新后），在**仓库根目录**执行：

   ```bash
   cd ../../wechatbot/nodejs && npm install && npm run build
   ```

3. 启动 Vibe-Trading API（示例端口 8899）：

   ```bash
   vibe-trading serve --port 8899
   ```

## 配置

| 环境变量 | 说明 | 默认 |
|----------|------|------|
| `VIBE_TRADING_BASE_URL` | API 根地址（无末尾 `/`） | `http://127.0.0.1:8899` |
| `WECHAT_BRIDGE_STATE_FILE` | `userId → sessionId` 持久化路径 | `~/.vibe-trading/wechat-bridge/state.json` |
| `VIBE_TURN_TIMEOUT_MS` | 单次对话等待 Agent 结束的上限 | `600000`（10 分钟） |
| `WECHAT_LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |
| `WECHAT_STREAM_ENABLED` | 是否将 `text_delta` 分段发到微信（`0`/`false` 关闭） | 开启 |
| `WECHAT_STREAM_INTERVAL_MS` | 流式分段：定时刷新的间隔（毫秒） | `1200` |
| `WECHAT_STREAM_MIN_CHARS` | 未达该字数则等定时器再发 | `180` |
| `WECHAT_MSG_MIN_GAP_MS` | 任意相邻微信消息（含流式段、工具提示）最小间隔 | `450` |
| `WECHAT_TOOL_NOTIFY` | 是否发送 `tool_call` / `tool_result` 简短提示（`0` 关闭） | 开启 |
| `WECHAT_TOOL_DISPLAY` | `each` 每条工具一行；`merge` 合并短时多工具（默认）；`result_only` 仅完成后提示 | `merge` |
| `WECHAT_TOOL_BATCH_MS` | merge 模式下合并窗口（毫秒） | `550` |

### 工具提示与流式在微信里的表现

- **位置**：所有回复均为 `reply(用户消息, 文本)`，在微信对话里会出现在**你的那条提问之后**，顺序与后端 SSE 一致，可与模型 **text_delta 流式分段**交错出现（先流式、中间插工具、再流式等，取决于 Agent 实际顺序）。
- **不能「替换」上一条**：微信侧一般**不能编辑**已发出气泡，因此无法用新消息在 UI 上覆盖旧提示；`merge` 模式只是**减少条数**（例如多条并行工具合并成一行 `⚙ a · b · c`），看起来像更紧凑的「状态区」，而不是替换。
- **仅看结果**：若希望少打扰，设 `WECHAT_TOOL_DISPLAY=result_only`，只在工具返回时发 `✓/✗` 行。

当前版本**不**向服务端发送鉴权头（与未设置 `API_AUTH_KEY` 时的 `vibe-trading serve` 一致）。

## 运行

在 `Vibe-Trading/wechat-bridge/` 下：

```bash
npm install
npm run build
npm start
```

开发调试：

```bash
npm run dev
```

终端会打印二维码 URL 对应的 ASCII 二维码，用微信扫码登录。

## 微信内指令

- `/new` 或 `/新会话` — 创建新的 Vibe-Trading 会话并绑定到当前微信用户（与网页「新建会话」类似，会话列表各自独立）。
- `/help` 或 `/帮助` — 显示简短说明。

## Docker Compose

`docker-compose.yml` 位于 `Vibe-Trading/`。`wechat-bridge` 镜像构建上下文为 **上一级目录**（`context: ..`），因此目录布局需为：与 `Vibe-Trading` **并列** 存在 `wechatbot/nodejs`（当前 monorepo 即如此）。

1. 在 **`Vibe-Trading/`** 下创建 **`.env`**（与 `docker-compose.yml` 同级）：可先 `cp .env.example .env`，再将 `agent/.env.example` 中的 LLM、数据源等合并进去；若此前只用 `agent/.env`，可执行 **`cp agent/.env .env`**，再按需追加 `.env.example` 里「微信桥」相关变量。
2. 启动 API + 微信桥：

   ```bash
   docker compose --profile wechat up -d --build
   ```

3. 首次登录需查看二维码日志：

   ```bash
   docker compose logs -f wechat-bridge
   ```

桥接容器通过 **`environment`** 使用 `VIBE_TRADING_BASE_URL=http://vibe-trading:8899`。宿主机数据目录为 **`{WECHAT_DATA_ROOT}/{WECHAT_INSTANCE_NAME}`**（默认 `./wechat-instances/default`），挂载到容器 **`/data`**（含微信凭证 `wechatbot/` 与 `state.json`）。

### 多微信实例（同一镜像、同一 compose、同一份 .env 模板）

隔离规则：**宿主机 `{WECHAT_DATA_ROOT}/{WECHAT_INSTANCE_NAME}/`** 挂载到容器 **`/data`**，微信凭证与桥接 state 均在此子目录下，与其它实例文件隔离。

| 变量 | 含义 |
|------|------|
| `WECHAT_DATA_ROOT` | 宿主机上存放各实例子目录的根（默认 `./wechat-instances`，已加入 `.gitignore`） |
| `WECHAT_INSTANCE_NAME` | 子目录名，如 `a`、`b` |
| `WECHAT_CONTAINER_NAME` | **可选**。不填时 Compose 自动生成唯一容器名（形如 `项目名-wechat-bridge-1`）；若需短名 `a`，与 `WECHAT_INSTANCE_NAME` 一并设为 `a` |

示例：微信账号 A，数据在 **`./wechat-instances/a/`**（推荐，不污染仓库根）：

```bash
WECHAT_DATA_ROOT=./wechat-instances WECHAT_INSTANCE_NAME=a \
  docker compose -p wt-a --profile wechat up -d --build
```

若希望目录为**项目根下 `./a/`**（`WECHAT_DATA_ROOT=. `）：

```bash
WECHAT_DATA_ROOT=. WECHAT_INSTANCE_NAME=a \
  docker compose -p wt-a --profile wechat up -d --build
```

再启账号 B（**必须**换 compose 项目名 `-p`，否则与 A 冲突）：

```bash
WECHAT_DATA_ROOT=./wechat-instances WECHAT_INSTANCE_NAME=b \
  docker compose -p wt-b --profile wechat up -d --build
```

同一时刻可运行多个桥容器，**共用**同一 `vibe-trading` 服务；查看日志：`docker compose -p wt-a logs -f wechat-bridge`。

### 日志与排查

- 桥接进程使用 SDK 的 **`createLogger`**（`WECHAT_LOG_LEVEL`），默认 **info**，输出到 **stderr**，单行格式含 **ISO 时间戳、级别、上下文 `[bridge]`**。
- `WeChatBot` 内部同样走分级日志，调试 iLink 时可设 `WECHAT_LOG_LEVEL=debug`。
- 容器内查看：`docker compose logs -f wechat-bridge`，或 `docker logs <container>`；与 `console` 不同，结构化行便于 `grep` / 日志采集。

仅启动 API（不构建微信桥）：`docker compose up -d`。

## 依赖关系

```
微信 ←→ @wechatbot/wechatbot（仓库 ../../wechatbot/nodejs）
        ↓ HTTP / SSE
        vibe-trading serve（Python）
```
