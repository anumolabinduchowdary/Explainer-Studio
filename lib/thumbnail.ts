/**
 * YouTube thumbnails: 1280×720 JPEG pictures made from the video's own
 * drawing, optionally with the title written large across the bottom.
 */

export const THUMBNAIL = { width: 1280, height: 720 } as const;
/** YouTube accepts thumbnails up to 2 MB. */
const MAX_DATA_URL_CHARS = 2_600_000;

/** Splits the title into at most two lines that fit `maxWidth`, shrinking the text if needed. */
function fitTitle(ctx: CanvasRenderingContext2D, title: string, font: string, maxWidth: number) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  for (let size = 92; size >= 46; size -= 4) {
    ctx.font = `700 ${size}px ${font}`;
    const lines: string[] = [];
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (ctx.measureText(next).width <= maxWidth || !current) current = next;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    if (lines.length <= 2 && lines.every((line) => ctx.measureText(line).width <= maxWidth)) return { size, lines };
  }
  // Still too long at the smallest size: keep two lines and end with "…".
  const size = 46;
  ctx.font = `700 ${size}px ${font}`;
  let text = title.trim();
  while (text.length > 4 && ctx.measureText(`${text}…`).width > maxWidth * 2) text = text.slice(0, -2);
  const middle = Math.ceil(text.length / 2);
  const split = text.lastIndexOf(" ", middle) > 0 ? text.lastIndexOf(" ", middle) : middle;
  return { size, lines: [text.slice(0, split).trim(), `${text.slice(split).trim()}…`] };
}

/** Writes the title across the bottom over a soft dark fade, with a dark outline so it reads on any picture. */
export function drawThumbnailTitle(ctx: CanvasRenderingContext2D, title: string, font: string) {
  const { width: W, height: H } = THUMBNAIL;
  if (!title.trim()) return;
  const fade = ctx.createLinearGradient(0, H * 0.5, 0, H);
  fade.addColorStop(0, "rgba(20, 12, 8, 0)");
  fade.addColorStop(1, "rgba(20, 12, 8, 0.72)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);

  const { size, lines } = fitTitle(ctx, title.toLocaleUpperCase(), font, W * 0.9);
  ctx.font = `700 ${size}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  const lineHeight = size * 1.08;
  let y = H - 44 - (lines.length - 1) * lineHeight;
  for (const line of lines) {
    ctx.strokeStyle = "#1F1410";
    ctx.lineWidth = size * 0.2;
    ctx.strokeText(line, W / 2, y);
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(line, W / 2, y);
    y += lineHeight;
  }
}

/**
 * Turns a drawn frame into the thumbnail: scaled to 1280×720, the title
 * added when given, and saved as a JPEG small enough for YouTube.
 */
export function thumbnailFrom(frame: HTMLCanvasElement, title?: string, font?: string): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL.width;
  canvas.height = THUMBNAIL.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(frame, 0, 0, THUMBNAIL.width, THUMBNAIL.height);
  if (title && font) drawThumbnailTitle(ctx, title, font);
  for (const quality of [0.9, 0.8, 0.65]) {
    const url = canvas.toDataURL("image/jpeg", quality);
    if (url.length <= MAX_DATA_URL_CHARS) return url;
  }
  return null;
}
