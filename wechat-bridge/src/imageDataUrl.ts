/**
 * OpenAI Chat Completions vision: image_url.url as data:image/...;base64,...
 * (same convention as the web UI).
 */

export type OpenAIUserContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** Max raw bytes before Base64; keep under agent content_utils MAX_DATA_URL_CHARS. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export function guessImageMime(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif'
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp'
  return 'image/jpeg'
}

export function bufferToImageDataUrl(data: Buffer, mime?: string): string {
  const m = mime ?? guessImageMime(data)
  return `data:${m};base64,${data.toString('base64')}`
}
