/**
 * 将微信消息转为发给 Vibe-Trading 的单段文本（与 pi-agent 思路一致，略化）。
 *
 * 说明：部分客户端会把截图当作「文件」下发（msg.type === file），此时需按图片走 vision，
 * 否则会走 /upload + 文本提示，模型看不到图内容。
 */

import { mkdtemp, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IncomingMessage, WeChatBot, Logger } from '@wechatbot/wechatbot'

import {
  bufferToImageDataUrl,
  guessImageMime,
  MAX_IMAGE_BYTES,
  type OpenAIUserContentPart,
} from './imageDataUrl.js'
import { uploadFile } from './vibe.js'

/** 发给 /sessions/.../messages 的 content：纯文本或与网页端一致的多模态 parts。 */
export type VibeUserContent = string | OpenAIUserContentPart[]

/** 与 agent/api_server.py /upload 一致：禁止可执行与压缩包 */
const BLOCKED_UPLOAD_EXT = new Set([
  '.exe',
  '.msi',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.app',
  '.dmg',
  '.so',
  '.dll',
  '.dylib',
  '.zip',
  '.rar',
  '.7z',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
])

/** 与网页端 Agent 上传上限一致 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** 微信以「文件」形式发来的常见图片扩展名 → 仍走 vision（image_url data URL） */
const IMAGE_FILE_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.heic',
  '.heif',
  '.tif',
  '.tiff',
])

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

/** 与 case image 一致：二进制 → multimodal vision */
async function visionPartsFromDownloadedImage(
  msg: IncomingMessage,
  bot: WeChatBot,
  log: Logger | undefined,
  source: string,
): Promise<VibeUserContent> {
  const media = await bot.download(msg)
  if (!media) {
    log?.warn('buildVibeUserContent: vision path download failed', { source })
    return '[图片无法下载]'
  }
  log?.info('buildVibeUserContent: vision path', {
    source,
    bytes: media.data.length,
    textPreview: (msg.text ?? '').slice(0, 120),
  })
  if (media.data.length > MAX_IMAGE_BYTES) {
    return truncate(
      `图片过大（超过 ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB），请发送较小的图片或压缩后再发。`,
    )
  }
  const mime = guessImageMime(media.data)
  const url = bufferToImageDataUrl(media.data, mime)
  const parts: OpenAIUserContentPart[] = []
  const userCaption = msg.text && msg.text !== '[image]' && msg.text !== '[file]' ? msg.text.trim() : ''
  if (userCaption) {
    parts.push({ type: 'text', text: truncate(userCaption) })
  } else {
    parts.push({
      type: 'text',
      text: '用户从微信发来一张图片，请理解图片内容并回复。',
    })
  }
  parts.push({ type: 'image_url', image_url: { url } })
  log?.info('buildVibeUserContent: vision multimodal ready', { source, mime, dataUrlChars: url.length })
  return parts
}

export async function buildVibeUserContent(
  baseUrl: string,
  msg: IncomingMessage,
  bot: WeChatBot,
  log?: Logger,
): Promise<VibeUserContent> {
  log?.info('buildVibeUserContent: start', {
    type: msg.type,
    textPreview: (msg.text ?? '').slice(0, 160),
    images: msg.images?.length ?? 0,
    files: msg.files?.length ?? 0,
    file0: msg.files?.[0]
      ? { name: msg.files[0].fileName, size: msg.files[0].size }
      : undefined,
  })

  switch (msg.type) {
    case 'text': {
      const t = msg.text?.trim() ?? ''
      log?.info('buildVibeUserContent: branch=text', { len: t.length })
      return truncate(t || '[空消息]')
    }

    case 'image': {
      log?.info('buildVibeUserContent: branch=image (native image message)')
      return visionPartsFromDownloadedImage(msg, bot, log, 'image')
    }

    case 'voice': {
      log?.info('buildVibeUserContent: branch=voice')
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
      const ext = extname(fileName).toLowerCase()

      log?.info('buildVibeUserContent: branch=file', { fileName, ext, size: file?.size })

      if (IMAGE_FILE_EXT.has(ext)) {
        log?.info(
          'buildVibeUserContent: file with image extension → vision path (not /upload)',
          { ext, fileName },
        )
        return visionPartsFromDownloadedImage(msg, bot, log, 'file-as-image')
      }

      if (BLOCKED_UPLOAD_EXT.has(ext)) {
        log?.warn('buildVibeUserContent: blocked ext', { ext })
        return truncate(
          `[文件类型 ${ext} 不允许上传（与网页一致：可执行文件与压缩包不支持，请先解压或换格式）。]`,
        )
      }

      if (TEXT_EXT.has(ext)) {
        log?.info('buildVibeUserContent: file branch=text-inline-read', { ext })
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

      try {
        log?.info('buildVibeUserContent: file branch=upload-to-vibe-api', { ext, fileName })
        const media = await bot.download(msg)
        if (!media) {
          return truncate(`[无法下载文件: ${fileName}${fileSize}]`)
        }
        if (media.data.length > MAX_UPLOAD_BYTES) {
          return truncate(`[文件过大（>${MAX_UPLOAD_BYTES / (1024 * 1024)}MB）: ${fileName}]`)
        }
        const uploadName = basename(fileName) || `wechat-upload${ext || '.bin'}`
        const up = await uploadFile(baseUrl, media.data, uploadName)
        log?.info('buildVibeUserContent: upload ok', { path: up.file_path, filename: up.filename })
        const head = `[Uploaded file: ${fileName}, path: ${up.file_path}]`
        const userNote =
          msg.text?.trim() &&
          msg.text.trim() !== '[file]' &&
          !/^[\[【]/.test(msg.text.trim())
            ? msg.text.trim()
            : ''
        if (userNote) {
          return truncate(`${head}\n\n${userNote}`)
        }
        return truncate(
          `${head}\n\n请根据该文件与用户需求处理（可使用 read_document 等工具读取附件）。`,
        )
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e)
        return truncate(`[文件已收到但上传 Vibe 失败: ${err}] 可尝试在网页端上传同一文件。`)
      }
    }

    case 'video': {
      log?.info('buildVibeUserContent: branch=video')
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
      log?.warn('buildVibeUserContent: unsupported type', { type: msg.type })
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
