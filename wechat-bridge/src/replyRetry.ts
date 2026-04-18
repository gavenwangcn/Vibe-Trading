/**
 * 微信 iLink sendmessage 在短时多次发送时常见 ret=-2（繁忙/限流等）。
 * 通过串行队列 + 指数退避重试，避免一条失败导致整轮对话后续内容全部丢失。
 */

import { ApiError, TransportError } from '@wechatbot/wechatbot'
import type { Logger } from '@wechatbot/wechatbot'

/** 单条发送最大尝试次数（含首次） */
const MAX_ATTEMPTS = Math.max(
  1,
  Math.min(12, Number(process.env.WECHAT_REPLY_MAX_RETRIES ?? 6) || 6),
)
/** 首次重试前基础等待（毫秒），实际为 base * 2^attempt + jitter */
const BASE_DELAY_MS = Math.max(
  100,
  Math.min(30_000, Number(process.env.WECHAT_REPLY_BASE_DELAY_MS ?? 700) || 700),
)
const CAP_DELAY_MS = Math.max(
  BASE_DELAY_MS,
  Math.min(60_000, Number(process.env.WECHAT_REPLY_MAX_DELAY_MS ?? 12_000) || 12_000),
)

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** 可对发送做重试的典型错误：iLink ret=-2、网络抖动等 */
export function isTransientWeChatSendError(e: unknown): boolean {
  if (e instanceof ApiError) {
    const c = e.errcode
    // -2：常见为繁忙/上下文冲突；可按需扩展
    if (c === -2 || c === -1) return true
    return false
  }
  if (e instanceof TransportError) return true
  if (e instanceof Error) {
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true
  }
  return false
}

/**
 * 进程内全局串行发送队列，避免多用户或多段逻辑交错触发 ret=-2。
 */
let sendChain: Promise<void> = Promise.resolve()

export function enqueueWeChatSend<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    sendChain = sendChain.then(async () => {
      try {
        resolve(await fn())
      } catch (e) {
        reject(e)
      }
    })
  })
}

/**
 * 带重试的发送。默认在「可重试错误」上尽力多次；最终仍失败则返回 false，不抛异常（便于继续发后续段落）。
 */
export async function sendWithRetry(
  log: Logger,
  label: string,
  send: () => Promise<void>,
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await send()
      if (attempt > 0) {
        log.info('wechat send recovered after retry', { label, attempt })
      }
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const transient = isTransientWeChatSendError(e)
      if (transient && attempt < MAX_ATTEMPTS - 1) {
        const jitter = Math.floor(Math.random() * 250)
        const delay = Math.min(
          CAP_DELAY_MS,
          BASE_DELAY_MS * 2 ** attempt + jitter,
        )
        log.warn('wechat send failed, will retry', {
          label,
          attempt: attempt + 1,
          maxAttempts: MAX_ATTEMPTS,
          delayMs: delay,
          error: msg,
        })
        await sleep(delay)
        continue
      }
      log.error('wechat send failed (giving up on this chunk)', {
        label,
        attempt: attempt + 1,
        transient,
        error: msg,
      })
      return false
    }
  }
  return false
}

/**
 * 队列 + 重试，供单条微信消息使用。
 */
export async function queuedSendWithRetry(
  log: Logger,
  label: string,
  send: () => Promise<void>,
): Promise<boolean> {
  return enqueueWeChatSend(() => sendWithRetry(log, label, send))
}
