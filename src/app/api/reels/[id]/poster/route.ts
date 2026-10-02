import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { reelMedia } from "@/lib/reel-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const media = await reelMedia(id, "poster");
  if (!media) return new Response("Still not found.", { status: 404 });
  if (media.url) return Response.redirect(media.url, 302);
  if (!media.file) return new Response("Still not found.", { status: 404 });
  const size = statSync(media.file).size;
  return new Response(Readable.toWeb(createReadStream(media.file)) as ReadableStream, {
    headers: {
      "Content-Type": media.type,
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
