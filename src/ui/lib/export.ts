import type { ExportPreset } from "../../shared/types.js";

/**
 * Delivery-size export happens here, in the browser, on a canvas.
 *
 * It has to: OpenAI cannot render 1920x1080 directly (1080 is not divisible
 * by 16), so 16:9 work is generated at an exact-aspect size and brought down
 * to Roblox's spec on the way out. Doing it client-side also keeps the
 * package free of a native image dependency.
 */

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = src;
  });
}

/** Scales to fill, centre-cropping whatever overflows. */
export async function renderToSize(
  src: string, width: number, height: number,
): Promise<Blob> {
  const img = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser blocked the canvas needed to resize.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't encode the image."))),
      "image/png",
    );
  });
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next frame so the download has already started.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

export async function downloadAtPreset(
  src: string, preset: ExportPreset, stem: string,
): Promise<void> {
  const blob = await renderToSize(src, preset.width, preset.height);
  saveBlob(blob, `${stem}-${preset.width}x${preset.height}.png`);
}

export async function downloadOriginal(src: string, stem: string): Promise<void> {
  const res = await fetch(src);
  saveBlob(await res.blob(), `${stem}.png`);
}

/** Reference images are read straight into memory; nothing is uploaded. */
export function readAsRef(file: File): Promise<{ data: string; mimeType: string; name: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        data: result.slice(result.indexOf(",") + 1),
        mimeType: file.type || "image/png",
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  });
}
