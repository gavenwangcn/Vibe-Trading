/**
 * 工具事件通知：仅在 tool_result 时发一条微信（不再单独发 tool_call）。
 *
 * 说明：微信协议下无法编辑已发送消息；merge 模式将短时间内的多条结果合并为一条。
 */

import type { RunTurnHandlers } from './vibe.js'

export type ToolDisplayMode = 'each' | 'merge' | 'result_only'

/** 单条：⚙️ + 成功/失败 + 工具名 + 耗时 */
function fmtResultLine(tool: string, status: string, elapsedMs?: number): string {
  const ok = status === 'ok'
  const sec = elapsedMs != null ? ` ${(elapsedMs / 1000).toFixed(1)}s` : ''
  return `⚙️ ${ok ? '✓' : '✗'} ${tool}${sec}`.slice(0, 280)
}

export function createToolHandlers(
  mode: ToolDisplayMode,
  batchMs: number,
  reply: (text: string) => Promise<void>,
): { handlers: RunTurnHandlers; flushPending: () => Promise<void> } {
  if (mode === 'each' || mode === 'result_only') {
    return {
      handlers: {
        onToolResult: async ({ tool, status, elapsed_ms: elapsedMs }) => {
          await reply(fmtResultLine(tool, status, elapsedMs))
        },
      },
      flushPending: async () => {},
    }
  }

  const resultLines: string[] = []
  let resultTimer: ReturnType<typeof setTimeout> | null = null

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

  const scheduleResults = (): void => {
    if (resultTimer) clearTimeout(resultTimer)
    resultTimer = setTimeout(() => void flushResults(), batchMs)
  }

  return {
    handlers: {
      onToolResult: async ({ tool, status, elapsed_ms: elapsedMs }) => {
        resultLines.push(fmtResultLine(tool, status, elapsedMs))
        scheduleResults()
      },
    },
    flushPending: async () => {
      await flushResults()
    },
  }
}
