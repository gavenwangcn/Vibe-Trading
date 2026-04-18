/** Resize and compress images for vision API (data URL, max side ~2048). */

const DEFAULT_MAX_SIDE = 2048;
const DEFAULT_QUALITY = 0.82;

export function fileToImageDataUrl(
  file: File,
  maxSide = DEFAULT_MAX_SIDE,
  quality = DEFAULT_QUALITY,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width <= 0 || height <= 0) {
        reject(new Error("Invalid image dimensions"));
        return;
      }
      const scale = Math.min(1, maxSide / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas not available"));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
      try {
        const dataUrl = canvas.toDataURL(mime, mime === "image/jpeg" ? quality : undefined);
        resolve(dataUrl);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image"));
    };
    img.src = url;
  });
}
