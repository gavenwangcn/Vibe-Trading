import { homedir } from 'node:os'
import { join } from 'node:path'

/** Base URL of vibe-trading serve (no trailing slash). */
export function getBaseUrl(): string {
  const u = process.env.VIBE_TRADING_BASE_URL?.trim() || 'http://127.0.0.1:8899'
  return u.replace(/\/$/, '')
}

/** Persist userId → sessionId mapping. */
export function getStatePath(): string {
  const p = process.env.WECHAT_BRIDGE_STATE_FILE?.trim()
  if (p) return p
  return join(homedir(), '.vibe-trading', 'wechat-bridge', 'state.json')
}
