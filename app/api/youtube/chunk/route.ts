import { CHUNK_BYTES } from "@/lib/youtube";
import { AppError } from "@/lib/server/appError";
import { sendChunk, unseal, youtubeRoute } from "@/lib/server/youtube";

export const maxDuration = 60;

/** YouTube accepts pieces in multiples of 256 KB, except the last one. */
const PIECE = 256 * 1024;

type Piece = { upload: string | null; start: number; total: number; bytes: Uint8Array<ArrayBuffer> };

async function readPiece(req: Request): Promise<Piece> {
  const start = Number(req.headers.get("x-upload-start"));
  const total = Number(req.headers.get("x-upload-total"));
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > CHUNK_BYTES) throw new AppError("invalid_input", 413, { message: "That piece of the video is too large." });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length > CHUNK_BYTES) throw new AppError("invalid_input", 413, { message: "That piece of the video is too large." });
  const last = start + bytes.length === total;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(total) ||
    start < 0 ||
    bytes.length === 0 ||
    bytes.length > CHUNK_BYTES ||
    start + bytes.length > total ||
    (!last && bytes.length % PIECE !== 0)
  ) {
    throw new AppError("invalid_input", 400, { message: "That piece of the video did not fit. Please press Upload again." });
  }
  return { upload: req.headers.get("x-upload"), start, total, bytes };
}

/** Passes one piece of the video on to YouTube. */
export const POST = youtubeRoute(
  "api/youtube/chunk",
  { perMinute: 240, read: readPiece },
  async ({ req, body, config }) => {
    const note = await unseal(config, "youtube-upload", body.upload);
    if (typeof note?.s !== "string" || typeof note.at !== "string" || note.n !== body.total) {
      throw new AppError("youtube_failed", 410, { message: "This upload has expired. Please press Upload again." });
    }
    return { body: await sendChunk(note.s, note.at, body.bytes, body.start, body.total, req.signal) };
  },
);
