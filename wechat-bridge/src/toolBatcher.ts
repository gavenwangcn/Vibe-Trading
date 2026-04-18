/**
 * 微信工具通知：在 tool_call 时发送（开始执行即发），tool_result 不再发消息。
 *
 * merge：短时多次 tool_call 合并为一条；each：每次调用一条；
 * result_only：仅工具名，不含参数预览（更短）。
 */

import type { RunTurnHandlers } from './vibe.js'

export type ToolDisplayMode = 'each' | 'merge' | 'result_only'

/** 工具名 + 可选参数预览（不含前缀图标，便于 merge 拼接） */
function fmtToolInner(tool: string, args: Record<string, string> | undefined, minimal: boolean): string {
  if (minimal) return tool.slice(0, 220)
  const preview = args
    ? Object.entries(args)
        .slice(0, 1)
        .map(([k]) => `${k}=…`)
        .join(' ')
    : ''
  const tail = preview ? ` (${preview})` : ''
  return `${tool}${tail}`.slice(0, 220)
}

function wrapLine(inner: string): string {
  return `⚙️ ${inner}`.slice(0, 280)
}

export function createToolHandlers(
  mode: ToolDisplayMode,
  batchMs: number,
  reply: (text: string) => Promise<void>,
): { handlers: RunTurnHandlers; flushPending: () => Promise<void> } {
  const minimal = mode === 'result_only'

  if (mode === 'each' || mode === 'result_only') {
    return {
      handlers: {
        onToolCall: async ({ tool, arguments: args }) => {
          const inner = fmtToolInner(tool, args, minimal)
          await reply(wrapLine(inner))
        },
      },
      flushPending: async () => {},
    }
  }

  const parts: string[] = []
  let callTimer: ReturnType<typeof setTimeout> | null = null

  const flushCalls = async (): Promise<void> => {
    if (callTimer) {
      clearTimeout(callTimer)
      callTimer = null
    }
    if (!parts.length) return
    const inner =
      parts.length === 1 ? parts[0] : parts.join(' · ').slice(0, 900)
    parts.length = 0
    await reply(wrapLine(inner))
  }

  const scheduleCalls = (): void => {
    if (callTimer) clearTimeout(callTimer)
    callTimer = setTimeout(() => void flushCalls(), batchMs)
  }

  return {
    handlers: {
      onToolCall: async ({ tool, arguments: args }) => {
        parts.push(fmtToolInner(tool, args, false))
        scheduleCalls()
      },
    },
    flushPending: async () => {
      await flushCalls()
    },
  }
}
