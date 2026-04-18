import EventSource from 'eventsource'

function waitOpen(es: EventSource): Promise<void> {
  return new Promise((resolve, reject) => {
    if (es.readyState === EventSource.OPEN) {
      resolve()
      return
    }
    const onOpen = (): void => {
      es.removeEventListener('open', onOpen)
      es.removeEventListener('error', onError)
      resolve()
    }
    const onError = (): void => {
      es.removeEventListener('open', onOpen)
      es.removeEventListener('error', onError)
      reject(new Error('EventSource 连接失败'))
    }
    es.addEventListener('open', onOpen)
    es.addEventListener('error', onError)
  })
}

/** 上传文件到 Vibe-Trading（与网页 /upload 一致，无鉴权时可直接调用）。 */
export async function uploadFile(
  baseUrl: string,
  data: Buffer,
  filename: string,
): Promise<{ file_path: string; filename: string }> {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(data)]), filename)
  const r = await fetch(`${baseUrl}/upload`, {
    method: 'POST',
    body: form,
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`上传失败 ${r.status}: ${t}`)
  }
  const j = (await r.json()) as { file_path: string; filename: string }
  return j
}

export async function createSession(baseUrl: string, title: string): Promise<string> {
  const r = await fetch(`${baseUrl}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`创建会话失败 ${r.status}: ${t}`)
  }
  const j = (await r.json()) as { session_id: string }
  return j.session_id
}

export async function sendUserMessage(
  baseUrl: string,
  sessionId: string,
  content: string,
): Promise<{ message_id: string; attempt_id: string }> {
  const r = await fetch(`${baseUrl}/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!r.ok) {
    const t = await r.text()
    throw new Error(`发送消息失败 ${r.status}: ${t}`)
  }
  return r.json() as Promise<{ message_id: string; attempt_id: string }>
}

/** SSE 增量与工具事件（与前端 useSSE 已知类型一致）。 */
export interface RunTurnHandlers {
  onTextDelta?: (delta: string) => void | Promise<void>
  onToolCall?: (data: {
    tool: string
    arguments?: Record<string, string>
  }) => void | Promise<void>
  onToolResult?: (data: {
    tool: string
    status: string
    elapsed_ms?: number
    preview?: string
  }) => void | Promise<void>
}

function waitAttemptWithEvents(
  es: EventSource,
  attemptId: string,
  timeoutMs: number,
  handlers?: RunTurnHandlers,
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  let chain: Promise<void> = Promise.resolve()

  const enqueue = (fn: () => void | Promise<void>): void => {
    chain = chain.then(() => fn()).catch(() => {})
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`等待 Agent 结束超时（${timeoutMs}ms）`))
    }, timeoutMs)

    let done = false

    const cleanup = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      es.removeEventListener('attempt.completed', onCompleted as EventListener)
      es.removeEventListener('attempt.failed', onFailed as EventListener)
      es.removeEventListener('text_delta', onTextDelta as EventListener)
      es.removeEventListener('tool_call', onToolCall as EventListener)
      es.removeEventListener('tool_result', onToolResult as EventListener)
    }

    const matchAttempt = (data: { attempt_id?: string }): boolean =>
      data.attempt_id === attemptId

    const onTextDelta = (ev: MessageEvent): void => {
      enqueue(async () => {
        try {
          const data = JSON.parse(String(ev.data)) as { attempt_id?: string; delta?: string }
          if (!matchAttempt(data)) return
          const d = data.delta ?? ''
          if (d && handlers?.onTextDelta) await handlers.onTextDelta(d)
        } catch {
          /* ignore */
        }
      })
    }

    const onToolCall = (ev: MessageEvent): void => {
      enqueue(async () => {
        try {
          const data = JSON.parse(String(ev.data)) as {
            attempt_id?: string
            tool?: string
            arguments?: Record<string, string>
          }
          if (!matchAttempt(data)) return
          if (handlers?.onToolCall && data.tool)
            await handlers.onToolCall({ tool: data.tool, arguments: data.arguments })
        } catch {
          /* ignore */
        }
      })
    }

    const onToolResult = (ev: MessageEvent): void => {
      enqueue(async () => {
        try {
          const data = JSON.parse(String(ev.data)) as {
            attempt_id?: string
            tool?: string
            status?: string
            elapsed_ms?: number
            preview?: string
          }
          if (!matchAttempt(data)) return
          if (handlers?.onToolResult && data.tool)
            await handlers.onToolResult({
              tool: data.tool,
              status: data.status ?? 'unknown',
              elapsed_ms: data.elapsed_ms,
              preview: data.preview,
            })
        } catch {
          /* ignore */
        }
      })
    }

    const onCompleted = (ev: MessageEvent): void => {
      enqueue(async () => {
        if (done) return
        try {
          const data = JSON.parse(String(ev.data)) as {
            attempt_id?: string
            summary?: string
          }
          if (!matchAttempt(data)) return
          cleanup()
          resolve({ ok: true, summary: data.summary ?? '' })
        } catch {
          /* ignore */
        }
      })
    }

    const onFailed = (ev: MessageEvent): void => {
      enqueue(async () => {
        if (done) return
        try {
          const data = JSON.parse(String(ev.data)) as {
            attempt_id?: string
            error?: string
          }
          if (!matchAttempt(data)) return
          cleanup()
          resolve({ ok: false, error: data.error ?? 'unknown' })
        } catch {
          /* ignore */
        }
      })
    }

    es.addEventListener('text_delta', onTextDelta as EventListener)
    es.addEventListener('tool_call', onToolCall as EventListener)
    es.addEventListener('tool_result', onToolResult as EventListener)
    es.addEventListener('attempt.completed', onCompleted as EventListener)
    es.addEventListener('attempt.failed', onFailed as EventListener)
  })
}

/**
 * 先建立 SSE，再发用户消息；监听 text_delta / tool_call / tool_result / attempt 结束。
 */
export async function runTurn(
  baseUrl: string,
  sessionId: string,
  content: string,
  timeoutMs: number,
  handlers?: RunTurnHandlers,
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  const url = `${baseUrl}/sessions/${encodeURIComponent(sessionId)}/events`
  const es = new EventSource(url)
  try {
    await waitOpen(es)
    const { attempt_id } = await sendUserMessage(baseUrl, sessionId, content)
    return await waitAttemptWithEvents(es, attempt_id, timeoutMs, handlers)
  } finally {
    es.close()
  }
}
