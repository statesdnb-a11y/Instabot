import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { PHOTO_DIR } from "@/lib/paths";
import { photoById } from "@/lib/photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const photo = photoById(id);
  if (!photo || photo.file.includes("/") || photo.file.includes("..")) {
    return new Response("Still not found.", { status: 404 });
  }
  const file = path.resolve(PHOTO_DIR, photo.file);
  const root = path.resolve(PHOTO_DIR);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) {
    return new Response("Still not found.", { status: 404 });
  }
  if (!existsSync(file)) return new Response("Still not found.", { status: 404 });
  const size = statSync(file).size;
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
