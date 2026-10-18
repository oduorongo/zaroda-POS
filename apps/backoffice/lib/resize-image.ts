// Shrinks a photo in the browser before it is uploaded, so a 4MB phone-camera shot goes over a slow
// connection as roughly 60-150KB. Shop photos only ever show at card/detail size, so 1200px on the
// long edge is plenty.

const MAX_EDGE = 1200;
const TARGET_BYTES = 150 * 1024;
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52];

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Decodes the picked file, honouring the camera's rotation flag so portrait shots aren't sideways. */
async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // fall through to the <img> route
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
}

/**
 * Returns a smaller WebP (or JPEG where the browser can't write WebP). If anything goes wrong, or the
 * result would not be smaller, the original file is returned unchanged and the server still validates it.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  try {
    const { source, width, height, release } = await decode(file);
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      // JPEG has no transparency - a transparent PNG would turn black without this.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

      let best: Blob | null = null;
      for (const quality of QUALITY_STEPS) {
        let blob = await toBlob(canvas, "image/webp", quality);
        if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
        if (!blob) return file;
        best = blob;
        if (blob.size <= TARGET_BYTES) break;
      }
      if (!best || best.size >= file.size) return file;
      const extension = best.type === "image/webp" ? "webp" : "jpg";
      const baseName = file.name.replace(/\.[^.]+$/, "") || "photo";
      return new File([best], `${baseName}.${extension}`, { type: best.type });
    } finally {
      release();
    }
  } catch {
    return file;
  }
}
