import fs from "node:fs";
import path from "node:path";
import { del, put } from "@vercel/blob";
import { RENDER_DIR } from "@/lib/paths";

export function blobEnabled() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

export function onVercel() {
  return process.env.VERCEL === "1";
}

export function videoExists(row: { video_path: string | null }) {
  if (!row.video_path) return false;
  if (row.video_path.startsWith("https://")) return true;
  return fs.existsSync(row.video_path);
}

function insideRenderDir(filePath: string) {
  const root = path.resolve(RENDER_DIR);
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export async function removeStoredVideo(stored: string | null) {
  if (!stored) return;
  if (stored.startsWith("https://")) {
    if (!blobEnabled()) return;
    await del(stored, { token: process.env.BLOB_READ_WRITE_TOKEN });
    return;
  }
  if (insideRenderDir(stored) && fs.existsSync(stored)) {
    fs.rmSync(stored, { force: true });
  }
}

export async function saveRenderedMp4(localPath: string, name: string) {
  if (!blobEnabled()) return localPath;
  const body = await fs.promises.readFile(localPath);
  const blob = await put(`reels/${name}`, body, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "video/mp4",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  await fs.promises.rm(localPath, { force: true });
  return blob.url;
}

export async function readVideoBytes(stored: string) {
  if (stored.startsWith("https://")) {
    const response = await fetch(stored);
    if (!response.ok) throw new Error("The silent reel file could not be read.");
    return Buffer.from(await response.arrayBuffer());
  }
  return fs.promises.readFile(stored);
}

export function renderOutputPath(id: string, nonce: number) {
  if (blobEnabled()) {
    const dir = path.join("/tmp", "instabot");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${id}-${nonce}.mp4`);
  }
  return path.join(RENDER_DIR, `${id}-${nonce}.mp4`);
}
