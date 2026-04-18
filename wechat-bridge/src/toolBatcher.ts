/**
 * 工具事件合并发送，减少刷屏。
 *
 * 说明：微信协议下无法编辑已发送消息，不能「替换」上一条气泡；
 * merge 模式用更少条消息概括同一时段内的多次 tool_call / tool_result。
 */

import type { RunTurnHandlers } from './vibe.js'

export type ToolDisplayMode = 'each' | 'merge' | 'result_only'

function fmtCallLine(tool: string, args?: Record<string, string>): string {
  const preview = args
    ? Object.entries(args)
        .slice(0, 1)
        .map(([k]) => `${k}=…`)
        .join(' ')
    : ''
  const tail = preview ? ` (${preview})` : ''
  return `🔧 ${tool}${tail}`.slice(0, 280)
}

function fmtResultLine(tool: string, status: string, elapsedMs?: number): string {
  const ok = status === 'ok'
  const sec = elapsedMs != null ? ` ${(elapsedMs / 1000).toFixed(1)}s` : ''
  return `${ok ? '✓' : '✗'} ${tool}${sec}`.slice(0, 280)
}

export function createToolHandlers(
  mode: ToolDisplayMode,
  batchMs: number,
  reply: (text: string) => Promise<void>,
): { handlers: RunTurnHandlers; flushPending: () => Promise<void> } {
  if (mode === 'each') {
    return {
      handlers: {
        onToolCall: async ({ tool, arguments: args }) => {
          await reply(fmtCallLine(tool, args))
        },
        onToolResult: async ({ tool, status, elapsed_ms: elapsedMs }) => {
          await reply(fmtResultLine(tool, status, elapsedMs))
        },
      },
      flushPending: async () => {},
    }
  }

  if (mode === 'result_only') {
    return {
      handlers: {
        onToolResult: async ({ tool, status, elapsed_ms: elapsedMs }) => {
          await reply(fmtResultLine(tool, status, elapsedMs))
        },
      },
      flushPending: async () => {},
    }
  }

  const callOrder: string[] = []
  const callSeen = new Set<string>()
  const resultLines: string[] = []
  let callTimer: ReturnType<typeof setTimeout> | null = null
  let resultTimer: ReturnType<typeof setTimeout> | null = null

  const flushCalls = async (): Promise<void> => {
    if (callTimer) {
      clearTimeout(callTimer)
      callTimer = null
    }
    if (!callOrder.length) return
    const line =
      callOrder.length === 1
        ? `⚙ ${callOrder[0]}`
        : `⚙ ${callOrder.join(' · ')}`.slice(0, 900)
    callOrder.length = 0
    callSeen.clear()
    await reply(line)
  }

  const flushResults = async (): Promise<void> => {
    if (resultTimer) {
      clearTimeout(resultTimer)
      resultTimer = null
    }
    if (!resultLines.length) return
    const text =
      resultLines.length === 1
        ? resultLines[0]
        : `📋 ${resultLines.join('\n')}`.slice(0, 900)
    resultLines.length = 0
    await reply(text)
  }

  const scheduleCalls = (): void => {
    if (callTimer) clearTimeout(callTimer)
    callTimer = setTimeout(() => void flushCalls(), batchMs)
  }

  const scheduleResults = (): void => {
    if (resultTimer) clearTimeout(resultTimer)
    resultTimer = setTimeout(() => void flushResults(), batchMs)
  }

  return {
    handlers: {
      onToolCall: async ({ tool }) => {
        if (!callSeen.has(tool)) {
          callSeen.add(tool)
          callOrder.push(tool)
        }
        scheduleCalls()
      },
      onToolResult: async ({ tool, status, elapsed_ms: elapsedMs }) => {
        await flushCalls()
        resultLines.push(fmtResultLine(tool, status, elapsedMs))
        scheduleResults()
      },
    },
    flushPending: async () => {
      await flushCalls()
      await flushResults()
    },
  }
}
