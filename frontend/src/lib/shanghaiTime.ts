/** Display and filenames use Asia/Shanghai regardless of the user's OS timezone. */

export const SHANGHAI_TZ = "Asia/Shanghai";

/** HH:mm (24h) in Shanghai (chat bubbles). */
export function formatTimestampShanghai(ts: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: SHANGHAI_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(new Date(ts));
}

/** Full datetime string in Shanghai (exports, tooltips). */
export function formatDateTimeShanghai(ts: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).format(new Date(ts));
}

/** YYYY-MM-DD in Shanghai (e.g. export filenames). */
export function formatDateShanghaiForFilename(ts: number = Date.now()): string {
  return new Date(ts).toLocaleDateString("en-CA", {
    timeZone: SHANGHAI_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
