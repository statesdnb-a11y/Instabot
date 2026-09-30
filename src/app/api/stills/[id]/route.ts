import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { resolvePhotoFile } from "@/lib/paths";
import { findPhoto } from "@/lib/photo-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const photo = findPhoto(id);
  let file = photo ? resolvePhotoFile(photo.file) : null;
  // Live search writes studio-${id}.jpg before the index entry is visible.
  // Render opens that file by name, so the thumbnail has to as well.
  if (!file && /^\d+$/.test(id)) file = resolvePhotoFile(`studio-${id}.jpg`);
  if (!file) return new Response("Still not found.", { status: 404 });
  const size = statSync(file).size;
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
