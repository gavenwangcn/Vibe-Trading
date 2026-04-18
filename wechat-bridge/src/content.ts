/**
 * 将微信消息转为发给 Vibe-Trading 的单段文本（与 pi-agent 思路一致，略化）。
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IncomingMessage } from '@wechatbot/wechatbot'
import type { WeChatBot } from '@wechatbot/wechatbot'

import { uploadFile } from './vibe.js'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

const TEXT_EXT = new Set([
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.xml',
  '.html',
  '.yaml',
  '.yml',
  '.toml',
  '.log',
  '.py',
  '.js',
  '.ts',
  '.go',
  '.rs',
  '.java',
  '.c',
  '.cpp',
  '.h',
])

const MAX_CONTENT = 5000

function truncate(s: string): string {
  if (s.length <= MAX_CONTENT) return s
  return `${s.slice(0, MAX_CONTENT - 20)}\n…[已截断至 ${MAX_CONTENT} 字]`
}

export async function buildVibeUserContent(
  baseUrl: string,
  msg: IncomingMessage,
  bot: WeChatBot,
): Promise<string> {
  switch (msg.type) {
    case 'text': {
      const t = msg.text?.trim() ?? ''
      return truncate(t || '[空消息]')
    }

    case 'image': {
      const media = await bot.download(msg)
      if (!media) return '[图片无法下载]'
      try {
        const up = await uploadFile(baseUrl, media.data, 'wechat-image.jpg')
        const note = msg.text && msg.text !== '[image]' ? msg.text : '用户从微信发来一张图片，已上传到服务器。'
        return truncate(`${note}\n本地路径（供工具读取）: ${up.file_path}`)
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        return truncate(`[图片已下载但上传 Vibe 失败: ${err}] 请改用文字描述需求，或在网页端上传。`)
      }
    }

    case 'voice': {
      const voice = msg.voices[0]
      if (voice?.text) return truncate(`[语音转文字] ${voice.text}`)
      const media = await bot.download(msg)
      if (media) {
        return truncate(
          `[语音消息 ${media.format ?? '?'}，${media.data.length} 字节，无转文字，请让用户改打字]`,
        )
      }
      return '[语音无法下载]'
    }

    case 'file': {
      const file = msg.files[0]
      const fileName = file?.fileName ?? 'unknown'
      const fileSize = file?.size ? ` (${formatFileSize(file.size)})` : ''
      if (TEXT_EXT.has(extname(fileName).toLowerCase())) {
        try {
          const media = await bot.download(msg)
          if (media) {
            const text = media.data.toString('utf-8')
            const truncated = text.length > 12000 ? `${text.slice(0, 12000)}\n…[截断]` : text
            return truncate(`[文件: ${fileName}${fileSize}]\n\n${truncated}`)
          }
        } catch {
          /* fall through */
        }
      }
      return truncate(
        `[收到文件: ${fileName}${fileSize}。若为文本请让用户粘贴内容或发可下载的纯文本文件。]`,
      )
    }

    case 'video': {
      const video = msg.videos[0]
      const duration = video?.durationMs ? ` 约 ${Math.round(video.durationMs / 1000)}s` : ''
      try {
        const media = await bot.download(msg)
        if (media) {
          const dir = await mkdtemp(join(tmpdir(), 'wechat-vid-'))
          const p = join(dir, 'video.mp4')
          await writeFile(p, media.data)
          return truncate(`[视频${duration}，已保存: ${p}]`)
        }
      } catch {
        /* fall through */
      }
      return `[视频${duration} 无法下载]`
    }

    default:
      return `[${msg.type} 类型暂不支持]`
  }
}

/** 从助手回复里抽取可发送的文件路径（与 pi-agent 一致） */
export function extractMediaPaths(text: string): string[] {
  const paths: string[] = []
  const mediaExts = /\.(png|jpg|jpeg|gif|webp|bmp|svg|mp4|mov|webm|avi|pdf|doc|docx|xls|xlsx|ppt|pptx|zip|tar|gz)$/i
  const pathRegex = /(?:^|\s)((?:\/[\w./-]+|\.\/[\w./-]+))/gm
  let match: RegExpExecArray | null
  while ((match = pathRegex.exec(text)) !== null) {
    const p = match[1].trim()
    if (mediaExts.test(p)) paths.push(p)
  }
  return [...new Set(paths)]
}

export function removeMediaPaths(text: string, paths: string[]): string {
  let result = text
  for (const p of paths) {
    result = result.replace(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
  }
  return result.replace(/\n{3,}/g, '\n\n').trim()
}

export { basename }
