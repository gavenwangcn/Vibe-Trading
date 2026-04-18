/**
 * text_delta → 分段发送：达 minChars 立即刷；否则按 interval 定时刷；单条上限避免单气泡过长。
 */

const MAX_CHARS_PER_MESSAGE = 720

export class TextStreamFlush {
  private acc = ''
  private sentTo = 0
  private tick: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly intervalMs: number,
    private readonly minChars: number,
    private readonly onChunk: (text: string) => Promise<void>,
  ) {}

  push(delta: string): void {
    if (!delta) return
    this.acc += delta
    const pending = this.acc.length - this.sentTo
    if (pending >= this.minChars) {
      if (this.tick) {
        clearInterval(this.tick)
        this.tick = null
      }
      void this.drain()
      return
    }
    if (!this.tick) {
      this.tick = setInterval(() => {
        void this.drain()
      }, this.intervalMs)
    }
  }

  /** 发送未发送片段，按 MAX_CHARS_PER_MESSAGE 切分 */
  private async drain(): Promise<void> {
    while (this.sentTo < this.acc.length) {
      const take = this.acc.slice(this.sentTo, this.sentTo + MAX_CHARS_PER_MESSAGE)
      if (!take.length) break
      await this.onChunk(take)
      this.sentTo += take.length
    }
    if (this.sentTo >= this.acc.length && this.tick) {
      clearInterval(this.tick)
      this.tick = null
    }
  }

  async flushTail(): Promise<void> {
    if (this.tick) {
      clearInterval(this.tick)
      this.tick = null
    }
    await this.drain()
  }

  getRaw(): string {
    return this.acc
  }
}
