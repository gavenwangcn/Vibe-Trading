/**
 * Vibe-Trading 微信桥（独立进程）：微信 ↔ Session + Agent（HTTP + SSE）。
 * 不合并前端托管；需另起 `vibe-trading serve`。
 */

import { readFile } from 'node:fs/promises'
import {
  WeChatBot,
  createLogger,
  stripMarkdown,
  type IncomingMessage,
  type LogLevel,
} from '@wechatbot/wechatbot'
import { toWeChatPlainText } from './wechatFormat.js'
import qrTerminal from 'qrcode-terminal'

import { getBaseUrl, getStatePath } from './config.js'
import {
  basename,
  buildVibeUserContent,
  extractMediaPaths,
  removeMediaPaths,
} from './content.js'
import { getSessionForUser, setSessionForUser } from './state.js'
import { createSession, runTurn, type RunTurnHandlers } from './vibe.js'
import { createToolHandlers, type ToolDisplayMode } from './toolBatcher.js'
import { queuedSendWithRetry } from './replyRetry.js'

const baseUrl = getBaseUrl()
const statePath = getStatePath()
const TURN_TIMEOUT_MS = Number(process.env.VIBE_TURN_TIMEOUT_MS ?? 600_000)

const WECHAT_STREAM_ENABLED =
  process.env.WECHAT_STREAM_ENABLED !== '0' && process.env.WECHAT_STREAM_ENABLED !== 'false'
const WECHAT_TOOL_NOTIFY =
  process.env.WECHAT_TOOL_NOTIFY !== '0' && process.env.WECHAT_TOOL_NOTIFY !== 'false'
const MSG_MIN_GAP_MS = Number(process.env.WECHAT_MSG_MIN_GAP_MS ?? 450)

const rawToolDisplay = (process.env.WECHAT_TOOL_DISPLAY ?? 'merge').trim().toLowerCase()
const WECHAT_TOOL_DISPLAY: ToolDisplayMode = ['each', 'merge', 'result_only'].includes(rawToolDisplay)
  ? (rawToolDisplay as ToolDisplayMode)
  : 'merge'
const TOOL_BATCH_MS = Number(process.env.WECHAT_TOOL_BATCH_MS ?? 550)

/** 登录二维码提示等 UI 文案 */
const SESSION_TITLE_PREFIX = (process.env.WECHAT_SESSION_TITLE_PREFIX ?? 'Trading Agent').trim() || 'Trading Agent'

/** 侧栏「全微信」分组：会话标题需以此前缀开头（与前端 Layout isWeChatSession 一致） */
const WECHAT_SIDEBAR_GROUP_PREFIX =
  (process.env.WECHAT_SIDEBAR_GROUP_TITLE_PREFIX ?? 'WeChat').trim() || 'WeChat'

function wechatListTitle(suffix: string): string {
  const s = suffix.trim()
  return s ? `${WECHAT_SIDEBAR_GROUP_PREFIX} · ${s}` : WECHAT_SIDEBAR_GROUP_PREFIX
}

function resolveLogLevel(): LogLevel {
  const l = (process.env.WECHAT_LOG_LEVEL ?? 'info').trim().toLowerCase()
  if (l === 'debug' || l === 'info' || l === 'warn' || l === 'error' || l === 'silent') return l
  return 'info'
}

/** 桥接进程日志：与 SDK 相同格式（时间戳 + 级别 + 上下文），输出 stderr，便于 `docker logs` 检索 */
const log = createLogger({ level: resolveLogLevel() }).child('bridge')

const busy = new Set<string>()

function isNewCommand(text: string): boolean {
  const t = text.trim().toLowerCase()
  return t === '/new' || t === '/新会话'
}

function isHelpCommand(text: string): boolean {
  const t = text.trim().toLowerCase()
  return t === '/help' || t === '/帮助' || t === '/intro' || t === '/介绍'
}

/** 对话内可见的能力说明（与微信「功能介绍」字段可保持语义一致；后者须在公众平台后台单独填写） */
const DEFAULT_CAPABILITY_INTRO =
  '【能力】AI 自动化盯盘、行情与策略解读、回测与组合讨论、交易相关辅助提醒等。输出仅供参考，不构成投资建议。'

function capabilityIntro(): string {
  const raw = process.env.WECHAT_CAPABILITY_INTRO?.trim()
  if (raw) return raw.replace(/\\n/g, '\n')
  return DEFAULT_CAPABILITY_INTRO
}

function buildHelpText(): string {
  return `${capabilityIntro()}

可用指令：
/new 或 /新会话 — 仅在微信内使用：开始新会话（侧栏「全微信」分组）
/help 或 /介绍 — 显示本说明

网页端请用侧栏 Sessions 旁的 + 新建会话，勿输入 /new。

直接发文字或图片等即与助手对话。`
}

/** 与已流式文本去重后的正文（若无剩余则空串） */
function sliceFinalSummary(summary: string, streamedRaw: string): string {
  const s = stripMarkdown(summary).trim()
  if (!s) return ''
  const t = stripMarkdown(streamedRaw).trim()
  if (!t) return s
  if (s === t) return ''
  if (s.startsWith(t)) return s.slice(t.length).trim()
  return s
}

function createSafeReplier(
  bot: WeChatBot,
  msg: IncomingMessage,
  userId: string,
  minGapMs: number,
): { reply: (text: string) => Promise<void>; stopTypingOnce: () => Promise<void> } {
  let last = 0
  let typingOff = false
  const stopTypingOnce = async (): Promise<void> => {
    if (typingOff) return
    typingOff = true
    try {
      await bot.stopTyping(userId)
    } catch {
      /* ignore */
    }
  }
  const reply = async (text: string): Promise<void> => {
    const trimmed = text.trim()
    if (!trimmed) return
    const now = Date.now()
    const wait = Math.max(0, minGapMs - (now - last))
    if (wait) await new Promise((r) => setTimeout(r, wait))
    await stopTypingOnce()
    const ok = await queuedSendWithRetry(log, 'reply-text', async () => {
      await bot.reply(msg, trimmed)
    })
    if (ok) last = Date.now()
  }
  return { reply, stopTypingOnce }
}

/** 非对话主流程里的纯文本回复（/help、新会话提示、桥接错误提示等），同样走队列 + 重试 */
async function replyPlain(
  bot: WeChatBot,
  msg: IncomingMessage,
  text: string,
  label: string,
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  await queuedSendWithRetry(log, label, async () => {
    await bot.reply(msg, trimmed)
  })
}

async function ensureSession(userId: string, label: string): Promise<string> {
  let sid = await getSessionForUser(statePath, userId)
  if (!sid) {
    sid = await createSession(baseUrl, wechatListTitle(label))
    await setSessionForUser(statePath, userId, sid)
  }
  return sid
}

async function handleHelp(bot: WeChatBot, msg: IncomingMessage): Promise<void> {
  await replyPlain(bot, msg, buildHelpText(), 'help')
}

async function handleNewSession(
  bot: WeChatBot,
  msg: IncomingMessage,
  userId: string,
): Promise<void> {
  const sid = await createSession(baseUrl, wechatListTitle(msg.userId.slice(0, 8)))
  await setSessionForUser(statePath, userId, sid)
  await replyPlain(bot, msg, '已开始新会话，可直接发消息对话。', 'new-session')
}

async function handleUserMessage(bot: WeChatBot, msg: IncomingMessage): Promise<void> {
  const userId = msg.userId
  if (busy.has(userId)) {
    await replyPlain(bot, msg, '上一条还在处理，请稍候再发。', 'busy')
    return
  }

  if (msg.type === 'text' && msg.text) {
    if (isHelpCommand(msg.text)) {
      await handleHelp(bot, msg)
      return
    }
    if (isNewCommand(msg.text)) {
      await handleNewSession(bot, msg, userId)
      return
    }
  }

  busy.add(userId)
  try {
    await bot.sendTyping(userId)
    const sessionId = await ensureSession(userId, userId.slice(0, 8))
    const content = await buildVibeUserContent(baseUrl, msg, bot)

    const { reply, stopTypingOnce } = createSafeReplier(bot, msg, userId, MSG_MIN_GAP_MS)

    let streamedRaw = ''
    /** 累积 SSE text_delta；回合结束时一次性 reply。iLink 对同一 context 多次 sendmessage 易 ret=-2，不分段逐条发。 */
    let streamAcc = ''

    const handlers: RunTurnHandlers = {}

    if (WECHAT_STREAM_ENABLED) {
      handlers.onTextDelta = async (delta: string) => {
        streamAcc += delta
      }
    }

    let flushToolPending: () => Promise<void> = async () => {}
    if (WECHAT_TOOL_NOTIFY) {
      const { handlers: toolH, flushPending } = createToolHandlers(
        WECHAT_TOOL_DISPLAY,
        TOOL_BATCH_MS,
        reply,
      )
      Object.assign(handlers, toolH)
      flushToolPending = flushPending
    }

    const result = await runTurn(baseUrl, sessionId, content, TURN_TIMEOUT_MS, handlers)

    await flushToolPending()

    if (WECHAT_STREAM_ENABLED) {
      streamedRaw = streamAcc
      const plain = toWeChatPlainText(streamAcc)
      if (plain) await reply(plain)
    }

    await stopTypingOnce()

    if (!result.ok) {
      log.warn('attempt failed', { error: result.error })
      await reply(`执行未成功：${result.error}`)
      return
    }

    const summaryRaw = result.summary ?? ''
    const mediaFiles = extractMediaPaths(summaryRaw)

    let body = sliceFinalSummary(summaryRaw, streamedRaw)
    if (body) {
      body = removeMediaPaths(body, mediaFiles)
      const plain = toWeChatPlainText(body)
      if (plain) await reply(plain)
    }

    if (mediaFiles.length > 0) {
      for (const filePath of mediaFiles) {
        try {
          const data = await readFile(filePath)
          const fileName = basename(filePath)
          await new Promise((r) => setTimeout(r, MSG_MIN_GAP_MS))
          const sent = await queuedSendWithRetry(log, 'reply-file', async () => {
            await bot.reply(msg, { file: data, fileName })
          })
          if (!sent) {
            await reply(`[文件发送失败: ${basename(filePath)}]`)
          }
        } catch (readErr) {
          log.warn('media read or send error', {
            path: filePath,
            error: readErr instanceof Error ? readErr.message : String(readErr),
          })
          await reply(`[文件发送失败: ${basename(filePath)}]`)
        }
      }
    }
  } catch (e) {
    try {
      await bot.stopTyping(userId)
    } catch {
      /* ignore */
    }
    const err = e instanceof Error ? e.message : String(e)
    log.error('handleUserMessage error', { error: err })
    await replyPlain(bot, msg, `桥接错误：${err}`, 'bridge-catch')
  } finally {
    busy.delete(userId)
  }
}

async function main(): Promise<void> {
  log.info('starting', {
    WECHAT_INSTANCE_NAME: process.env.WECHAT_INSTANCE_NAME ?? '',
    VIBE_TRADING_BASE_URL: baseUrl,
    statePath,
    stream: WECHAT_STREAM_ENABLED,
    toolNotify: WECHAT_TOOL_NOTIFY,
    toolDisplay: WECHAT_TOOL_DISPLAY,
    toolBatchMs: TOOL_BATCH_MS,
    msgMinGapMs: MSG_MIN_GAP_MS,
  })

  const logLevel = resolveLogLevel()
  const storageDir = process.env.WECHATBOT_STORAGE_DIR?.trim()
  const bot = new WeChatBot({
    storage: 'file',
    ...(storageDir ? { storageDir } : {}),
    logLevel,
  })

  bot.onMessage((msg) => {
    void handleUserMessage(bot, msg)
  })

  bot.on('error', (err) => {
    log.error('WeChatBot error', { detail: err instanceof Error ? err.message : String(err) })
  })
  bot.on('session:expired', () => {
    log.warn('WeChat session expired, SDK will try to restore')
  })
  bot.on('session:restored', (c) => {
    log.info('WeChat session restored', { accountId: c.accountId })
  })

  await bot.login({
    force: false,
    callbacks: {
      onQrUrl: (url) => {
        qrTerminal.generate(url, { small: true }, (qr: string) => {
          process.stderr.write(`\n  Vibe-Trading · ${SESSION_TITLE_PREFIX} — 请使用微信扫描以下二维码登录：\n\n`)
          for (const line of qr.split('\n')) {
            process.stderr.write(`  ${line}\n`)
          }
          process.stderr.write('\n')
        })
      },
      onScanned: () => {
        log.info('QR scanned, confirm in WeChat')
      },
      onExpired: () => {
        log.warn('QR expired, refreshing')
      },
    },
  })

  const creds = bot.getCredentials()
  log.info('logged in', { accountId: creds?.accountId ?? 'unknown' })

  void bot.start().catch((e) => {
    log.error('message poller failed', { detail: e instanceof Error ? e.message : String(e) })
    process.exit(1)
  })

  const shutdown = (): void => {
    log.info('shutting down')
    bot.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((e) => {
  log.error('fatal startup error', { detail: e instanceof Error ? e.message : String(e) })
  process.exit(1)
})
