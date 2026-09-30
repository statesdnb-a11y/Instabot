import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { resolvePhotoFile } from "@/lib/paths";
import { findPhoto } from "@/lib/photo-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

function rejectsPath(id: string) {
  if (!id || id.includes("\0") || id.includes("..") || id.includes("/") || id.includes("\\")) return true;
  return path.basename(id) !== id;
}

function jpegResponse(body: BodyInit, size: number) {
  return new Response(body, {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=86400",
    },
  });
}

function localStill(id: string) {
  const photo = findPhoto(id);
  const named = photo ? resolvePhotoFile(photo.file) : null;
  if (named) return named;
  if (/^\d+$/.test(id)) return resolvePhotoFile(`studio-${id}.jpg`);
  return null;
}

async function pexelsJpeg(id: string) {
  const url = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1600`;
  const upstream = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "image/jpeg" },
    signal: AbortSignal.timeout(20000),
  });
  if (!upstream.ok) return null;
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  return bytes;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (rejectsPath(id)) return new Response("Still not found.", { status: 400 });

  const file = localStill(id);
  if (file) {
    const size = statSync(file).size;
    return jpegResponse(Readable.toWeb(createReadStream(file)) as ReadableStream, size);
  }

  if (!/^\d+$/.test(id)) return new Response("Still not found.", { status: 404 });

  try {
    const bytes = await pexelsJpeg(id);
    if (!bytes) return new Response("Still not found.", { status: 404 });
    return jpegResponse(bytes, bytes.length);
  } catch {
    return new Response("Still not found.", { status: 404 });
  }
}
