/**
 * 将 Agent 输出转为微信里更易读的纯文本（微信不支持 Markdown/HTML 表格）。
 * 先 stripMarkdown，再对「表格压成一行」「过密段落」做轻量排版。
 */

import { stripMarkdown } from '@wechatbot/wechatbot'

/** 行内出现多处「两个以上空格」分隔的列时，拆成多行并以 · 开头（常见于 Markdown 表格转纯文本后） */
function expandPackedTableLikeLine(line: string): string {
  const trimmed = line.trim()
  if (trimmed.length < 24) return line
  const parts = trimmed.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 3) return line
  return parts.map((p) => `· ${p}`).join('\n')
}

/** 在常见小节标题前补空行（若紧贴上一字符） */
function ensureBreakBeforeSectionTitles(text: string): string {
  return text.replace(
    /([^\n])(?=(?:盯盘任务列表|当前正在运行|任务列表|监控逻辑|策略名称|合约[:：]|状态[:：]|开始时间|结束时间))/g,
    '$1\n\n',
  )
}

/**
 * Agent / SSE 文本 → 发往微信的最终纯文本
 */
export function toWeChatPlainText(raw: string): string {
  let s = stripMarkdown(raw)
  s = ensureBreakBeforeSectionTitles(s)

  const lines = s.split('\n')
  const out: string[] = []
  for (const line of lines) {
    if (/\s{2,}/.test(line) && line.trim().length > 30) {
      out.push(expandPackedTableLikeLine(line))
    } else {
      out.push(line)
    }
  }
  s = out.join('\n')
  s = s.replace(/\n{4,}/g, '\n\n\n')
  return s.trim()
}
