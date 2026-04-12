/**
 * Turn agent-written paths under `artifacts/` into:
 * - Markdown images for common image types
 * - Markdown download links for csv / office / pdf / etc.
 * when `runId` is known (same origin as API).
 */

const IMG_EXT = /\.(png|jpg|jpeg|gif|webp|svg)$/i;

/** Non-image artifacts that should appear as clickable downloads */
const DOWNLOAD_EXT = /\.(csv|tsv|xlsx|xls|docx|doc|pdf|txt|json|md|zip|parquet|html|htm|xml)$/i;

function safeBasename(rel: string): string | null {
  const name = rel.split("/").pop() || rel;
  if (!/^[\w.\-]+$/i.test(name)) return null;
  return name;
}

function artifactUrl(runId: string, name: string): string {
  const enc = encodeURIComponent(name);
  return `/runs/${runId}/artifacts/${enc}`;
}

/** Replace `` `artifacts/...` `` inline code */
function replaceBacktickArtifacts(content: string, runId: string): string {
  return content.replace(/`artifacts\/([^`\n]+)`/gi, (full, rel: string) => {
    const name = safeBasename(rel.trim());
    if (!name) return full;
    if (IMG_EXT.test(name)) {
      return `![chart](${artifactUrl(runId, name)})`;
    }
    if (DOWNLOAD_EXT.test(name)) {
      return `[📎 ${name}](${artifactUrl(runId, name)})`;
    }
    return full;
  });
}

/** Replace bare `artifacts/file.ext` (not already in markdown link/image) */
function replaceBareArtifacts(content: string, runId: string): string {
  return content.replace(
    /(^|[^\w/])artifacts\/([A-Za-z0-9_.\-]+\.(?:png|jpg|jpeg|gif|webp|svg|csv|tsv|xlsx|xls|docx|doc|pdf|txt|json|md|zip|parquet|html|htm|xml))\b/gim,
    (full, prefix: string, file: string) => {
      const name = safeBasename(file);
      if (!name) return full;
      const url = artifactUrl(runId, name);
      if (IMG_EXT.test(name)) {
        return `${prefix}![chart](${url})`;
      }
      if (DOWNLOAD_EXT.test(name)) {
        return `${prefix}[📎 ${name}](${url})`;
      }
      return full;
    },
  );
}

/** Public API */
export function embedRunArtifactsInMarkdown(content: string, runId: string | undefined): string {
  if (!runId?.trim()) return content;
  const rid = runId.trim();

  let out = replaceBacktickArtifacts(content, rid);
  out = replaceBareArtifacts(out, rid);
  return out;
}

/** @deprecated use embedRunArtifactsInMarkdown */
export const embedArtifactImagesAsMarkdown = embedRunArtifactsInMarkdown;
