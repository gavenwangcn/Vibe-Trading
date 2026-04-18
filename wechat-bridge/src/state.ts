import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type UserState = {
  sessionId: string
  updatedAt: string
}

export type BridgeStateFile = {
  users: Record<string, UserState>
}

export async function loadState(path: string): Promise<BridgeStateFile> {
  try {
    const raw = await readFile(path, 'utf-8')
    const j = JSON.parse(raw) as BridgeStateFile
    if (!j.users || typeof j.users !== 'object') return { users: {} }
    return j
  } catch {
    return { users: {} }
  }
}

export async function saveState(path: string, state: BridgeStateFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(state, null, 2), 'utf-8')
}

export async function getSessionForUser(
  path: string,
  userId: string,
): Promise<string | undefined> {
  const s = await loadState(path)
  return s.users[userId]?.sessionId
}

export async function setSessionForUser(
  path: string,
  userId: string,
  sessionId: string,
): Promise<void> {
  const s = await loadState(path)
  s.users[userId] = {
    sessionId,
    updatedAt: new Date().toISOString(),
  }
  await saveState(path, s)
}

export async function clearSessionForUser(path: string, userId: string): Promise<void> {
  const s = await loadState(path)
  delete s.users[userId]
  await saveState(path, s)
}
