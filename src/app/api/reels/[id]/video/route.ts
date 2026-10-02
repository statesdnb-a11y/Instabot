import { createReadStream } from "node:fs";
import { statSync } from "node:fs";
import { Readable } from "node:stream";
import { reelMedia } from "@/lib/reel-media";
import { blobPlaybackRedirect, safeMediaError } from "@/lib/media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const download = new URL(request.url).searchParams.get("download") === "1";
  const media = await reelMedia(id, "video");
  if (!media) return new Response("Reel not found.", { status: 404 });
  if (media.url) {
    try {
      return await blobPlaybackRedirect(media.url, download);
    } catch (error) {
      return new Response(safeMediaError(error), { status: 502 });
    }
  }
  if (!media.file) return new Response("Reel not found.", { status: 404 });

  const size = statSync(media.file).size;
  const baseHeaders: Record<string, string> = {
    "Content-Type": media.type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  if (download && media.downloadName) {
    baseHeaders["Content-Disposition"] = `attachment; filename="${media.downloadName}"`;
  }

  const range = request.headers.get("range");
  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) return new Response("Bad range.", { status: 416 });
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new Response("Bad range.", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const stream = createReadStream(media.file, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = createReadStream(media.file);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
