# Vibe-Trading 微信桥（独立进程）

与浏览器 Web UI **并行**：微信消息走本桥 → `vibe-trading serve` 的 Session / Agent（HTTP + SSE），**不**托管前端静态资源。

本目录位于 `Vibe-Trading/wechat-bridge/`；依赖同仓库内的 **`Vibe-Trading/wechatbot/nodejs`**（@wechatbot/wechatbot SDK）。

## 前置

1. 已安装 **Node.js ≥ 22**。
2. 先构建本地 SDK（仅首次或 SDK 更新后），在 **`Vibe-Trading/wechatbot/nodejs`** 执行：

   ```bash
   cd ../wechatbot/nodejs && npm install && npm run build
   ```

   （若在 `wechat-bridge/` 目录下，则为 `cd ../wechatbot/nodejs`。）

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
| `WECHAT_STREAM_ENABLED` | 是否在回合内接收 SSE `text_delta` 并在**结束后一次性**发到微信（`0` 则仅发最终 summary；见下行说明） | 开启 |
| `WECHAT_STREAM_INTERVAL_MS` | （保留）旧版分段间隔；当前实现已改为回合末单次发送，可忽略 | — |
| `WECHAT_STREAM_MIN_CHARS` | （保留）旧版分段字数阈值；当前可忽略 | — |
| `WECHAT_MSG_MIN_GAP_MS` | 任意相邻微信消息（含流式段、工具提示）最小间隔 | `450` |
| `WECHAT_TOOL_NOTIFY` | 是否发送 `tool_call` / `tool_result` 简短提示（`0` 关闭） | 开启 |
| `WECHAT_TOOL_DISPLAY` | `each` 每条工具一行；`merge` 合并短时多工具（默认）；`result_only` 仅完成后提示 | `merge` |
| `WECHAT_TOOL_BATCH_MS` | merge 模式下合并窗口（毫秒） | `550` |
| `WECHAT_SESSION_TITLE_PREFIX` | 同步到 Vibe 会话标题（网页端列表），如 `Trading Agent` | `Trading Agent` |
| `WECHAT_CAPABILITY_INTRO` | `/help`、`/介绍` 中展示的能力说明；可与公众平台「功能介绍」文案对齐 | 见代码默认段 |

### 微信里的机器人头像、名称与「功能介绍」（clawbot 等）

本仓库与 `@wechatbot/wechatbot` **不提供**修改下列内容的 API；它们由**微信侧**在云端配置，与扫码登录所用机器人账号绑定：

- **头像**（如默认 clawbot 图标）
- **对外显示名称**
- **功能介绍**（添加好友/资料页里的简介文案）

#### 常用入口与文档（请以页面为准，产品会迭代）

| 说明 | 链接 |
|------|------|
| **微信对话开放平台**（登录后台、管理对话机器人） | [https://chatbot.weixin.qq.com/](https://chatbot.weixin.qq.com/) |
| **机器人信息 / 基础信息**（官方文档：名称、ID、权限说明） | [https://developers.weixin.qq.com/doc/aispeech/platform/account/accounts.html](https://developers.weixin.qq.com/doc/aispeech/platform/account/accounts.html) |
| **clawbot / 相关接口说明**（偏开发接口，非后台截图） | [https://developers.weixin.qq.com/doc/aispeech/knowledge/openapi/Clawbotrelated.html](https://developers.weixin.qq.com/doc/aispeech/knowledge/openapi/Clawbotrelated.html) |

#### 操作路径（与官方「机器人信息」文档一致）

1. 浏览器打开 **微信对话开放平台**：[https://chatbot.weixin.qq.com/](https://chatbot.weixin.qq.com/)，使用拥有该机器人权限的微信号 / 管理员账号登录。
2. 页面 **左上角** 点击当前 **机器人名称**，在列表中选中要改的机器人（或先 **新建机器人**）。
3. 左侧菜单进入：**【运营】→【基础设置】→【机器人信息】→【基础信息】**。
4. 在此页可编辑 **机器人名称** 等（**机器人 ID** 为系统生成不可改）；**删除机器人** 仅超级管理员可见。
5. 若还有 **功能介绍、头像** 等字段，以你账号下实际展示的表单项为准，将简介改为例如：**AI 自动化盯盘、行情与策略解读、回测与交易辅助提醒**（注意字数限制）。

**说明：** 微信开放文档写明，**机器人头像**在部分场景下 **「仅对小程序插件生效，且仅在插件中可见」**。若你在后台看不到头像或简介编辑项，可能是当前接入形态（纯 iLink 对话链路等）不支持在后台改展示信息，需以页面实际为准或咨询微信侧/服务商。

若机器人是通过 **`@tencent-weixin/openclaw-weixin-cli`** 等脚本创建、而非在 `chatbot.weixin.qq.com` 后台创建，**管理入口可能仍在上述开放平台**，也可能在 CLI / 服务商文档中另有说明，请对照你注册时使用的官方指引。

---

对话内能力与说明文案可通过环境变量 **`WECHAT_CAPABILITY_INTRO`** 自定义；用户发 **`/help`** 或 **`/介绍`** 时会看到（与资料页「功能介绍」需分别在后台与本变量中维护）。

### 流式与 `ret=-2`

微信 iLink 对同一轮 `context_token` 多次 `sendmessage` 可能返回 **`ret: -2`（参数/上下文错误）**。因此开启 `WECHAT_STREAM_ENABLED` 时，桥接会**累积**整段 `text_delta`，在 Agent 回合结束后**合并为一条**文本再 `reply`（长文仍由 SDK 内部分块）。若仍报错，可试 `WECHAT_TOOL_NOTIFY=0` 减少同轮多次 `reply`（工具提示）。

### 工具提示与流式在微信里的表现

- **位置**：主回复为回合末一条（或工具提示多条）；在微信里出现在**你的那条提问之后**。
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

`docker-compose.yml` 位于 `Vibe-Trading/`。`wechat-bridge` 镜像构建上下文为 **`Vibe-Trading` 根目录**（`context: .`），SDK 位于 **`./wechatbot/nodejs/`**，与 compose 同级，无需再在上级目录放一份 `wechatbot`。

1. 分别准备环境文件（**不要**混用）：`cp agent/.env.example agent/.env` 并填写 LLM 等；`cp wechat-bridge/.env.example wechat-bridge/.env` 并按需调整微信桥变量。**仓库根目录不需要 `.env`。**
2. 启动 API + 微信桥：

   ```bash
   docker compose up -d --build
   ```

3. 首次登录需查看二维码日志：

   ```bash
   docker compose logs -f wechat-bridge
   ```

桥接容器通过 **`environment`** 使用 `VIBE_TRADING_BASE_URL=http://vibe-trading:8899`。宿主机数据目录为 **`{WECHAT_DATA_ROOT}/{WECHAT_INSTANCE_NAME}`**（默认 `./wechat-instances/default`），挂载到容器 **`/data`**（含微信凭证 `wechatbot/` 与 `state.json`）。

### 多微信实例（同一镜像、同一 compose；数据目录与 `wechat-bridge/.env` 中实例变量配合）

隔离规则：**宿主机 `{WECHAT_DATA_ROOT}/{WECHAT_INSTANCE_NAME}/`** 挂载到容器 **`/data`**，微信凭证与桥接 state 均在此子目录下，与其它实例文件隔离。

| 变量 | 含义 |
|------|------|
| `WECHAT_DATA_ROOT` | 宿主机上存放各实例子目录的根（默认 `./wechat-instances`，已加入 `.gitignore`） |
| `WECHAT_INSTANCE_NAME` | 子目录名，如 `a`、`b` |
| `WECHAT_CONTAINER_NAME` | **可选**。不填时 Compose 自动生成唯一容器名（形如 `项目名-wechat-bridge-1`）；若需短名 `a`，与 `WECHAT_INSTANCE_NAME` 一并设为 `a` |

示例：微信账号 A，数据在 **`./wechat-instances/a/`**（推荐，不污染仓库根）：

```bash
WECHAT_DATA_ROOT=./wechat-instances WECHAT_INSTANCE_NAME=a \
  docker compose -p wt-a up -d --build
```

若希望目录为**项目根下 `./a/`**（`WECHAT_DATA_ROOT=. `）：

```bash
WECHAT_DATA_ROOT=. WECHAT_INSTANCE_NAME=a \
  docker compose -p wt-a up -d --build
```

再启账号 B（**必须**换 compose 项目名 `-p`，否则与 A 冲突）：

```bash
WECHAT_DATA_ROOT=./wechat-instances WECHAT_INSTANCE_NAME=b \
  docker compose -p wt-b up -d --build
```

同一时刻可运行多个桥容器，**共用**同一 `vibe-trading` 服务；查看日志：`docker compose -p wt-a logs -f wechat-bridge`。

### 日志与排查

- 桥接进程使用 SDK 的 **`createLogger`**（`WECHAT_LOG_LEVEL`），默认 **info**，输出到 **stderr**，单行格式含 **ISO 时间戳、级别、上下文 `[bridge]`**。
- `WeChatBot` 内部同样走分级日志，调试 iLink 时可设 `WECHAT_LOG_LEVEL=debug`。
- 容器内查看：`docker compose logs -f wechat-bridge`，或 `docker logs <container>`；与 `console` 不同，结构化行便于 `grep` / 日志采集。

仅启动 API（不启微信桥）：`docker compose up -d vibe-trading`。

## 依赖关系

```
微信 ←→ @wechatbot/wechatbot（../wechatbot/nodejs）
        ↓ HTTP / SSE
        vibe-trading serve（Python）
```
