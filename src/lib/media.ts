import fs from "node:fs";
import path from "node:path";
import { del, get, issueSignedToken, presignUrl, put } from "@vercel/blob";
import { RENDER_DIR } from "@/lib/paths";

function env(name: string) {
  const value = process.env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function blobEnabled() {
  return Boolean(env("instabot_STORE_ID") || env("BLOB_STORE_ID") || readWriteToken());
}

function readWriteToken() {
  return env("BLOB_READ_WRITE_TOKEN") || env("instabot_READ_WRITE_TOKEN");
}

/**
 * OIDC needs a store id and must not receive a token option.
 * `@vercel/blob` uses an explicit token instead of `VERCEL_OIDC_TOKEN`, and an
 * empty string is not a credential. On Vercel the store id is `instabot_STORE_ID`
 * when the connected store's env prefix is `instabot`.
 */
function blobCommand(): { storeId: string } | { token: string } {
  const storeId = env("instabot_STORE_ID") || env("BLOB_STORE_ID");
  if (storeId) return { storeId };
  const token = readWriteToken();
  if (token) return { token };
  throw new Error("Blob storage is enabled, but no store id or read-write token is set.");
}

export function onVercel() {
  return process.env.VERCEL === "1";
}

export function isPublicBlobUrl(value: string) {
  return blobHost(value)?.endsWith(".public.blob.vercel-storage.com") ?? false;
}

export function isBlobUrl(value: string) {
  return blobHost(value)?.endsWith(".blob.vercel-storage.com") ?? false;
}

function blobHost(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

function blobPathname(stored: string) {
  const pathname = new URL(stored).pathname.replace(/^\/+/, "");
  if (!pathname) throw new Error("The stored reel URL has no file name.");
  return pathname;
}

export type StoredVideoKind = "public-blob" | "private-blob" | "local" | "missing";

export function storedVideoKind(stored: string | null): StoredVideoKind {
  if (!stored) return "missing";
  if (isPublicBlobUrl(stored)) return "public-blob";
  if (isBlobUrl(stored)) return "private-blob";
  if (insideRenderDir(stored) && fs.existsSync(stored)) return "local";
  return "missing";
}

export function videoExists(row: { video_path: string | null }) {
  return storedVideoKind(row.video_path) !== "missing";
}

function insideRenderDir(filePath: string) {
  const root = path.resolve(RENDER_DIR);
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export function safeMediaError(error: unknown) {
  const message = error instanceof Error ? error.message : "The cut failed.";
  return message
    .replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, "[token]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]")
    .slice(-500);
}

export async function removeStoredVideo(stored: string | null) {
  if (!stored) return;
  if (isBlobUrl(stored)) {
    if (!blobEnabled()) return;
    await del(stored, blobCommand());
    return;
  }
  if (insideRenderDir(stored) && fs.existsSync(stored)) {
    fs.rmSync(stored, { force: true });
  }
}

function looksLikeMp4(body: Buffer) {
  return body.length >= 12 && body.subarray(4, 8).toString("ascii") === "ftyp";
}

export async function saveRenderedMp4(localPath: string, name: string) {
  if (!blobEnabled()) {
    if (onVercel()) {
      throw new Error(
        "This host cannot keep the mp4 on disk. Connect a public Vercel Blob store (instabot_STORE_ID or BLOB_STORE_ID).",
      );
    }
    return localPath;
  }

  const body = await fs.promises.readFile(localPath);
  if (!looksLikeMp4(body)) {
    throw new Error("ffmpeg did not write a playable mp4.");
  }

  let blob: { url: string };
  try {
    blob = await put(`reels/${name}`, body, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "video/mp4",
      ...blobCommand(),
    });
  } catch (error) {
    const message = safeMediaError(error);
    if (message.includes("Access denied") || message.includes("No blob credentials")) {
      throw new Error(
        "Vercel Blob refused the upload. instabot_STORE_ID is set, but OIDC did not grant access. Connect this public Blob store to the project and enable OIDC for Production.",
      );
    }
    throw new Error(message);
  }

  if (!isPublicBlobUrl(blob.url)) {
    await del(blob.url, blobCommand()).catch(() => undefined);
    throw new Error(
      "The Blob store did not return a public video URL. A private store cannot be played in the browser. Create the store with public access, then cut the reel again.",
    );
  }

  await fs.promises.rm(localPath, { force: true });
  return blob.url;
}

export async function readVideoBytes(stored: string) {
  if (isBlobUrl(stored)) {
    if (isPublicBlobUrl(stored)) {
      const response = await fetch(stored);
      if (!response.ok) throw new Error("The silent reel file could not be read.");
      return Buffer.from(await response.arrayBuffer());
    }
    const result = await get(stored, { access: "private", ...blobCommand() });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error("The silent reel file could not be read.");
    }
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
  return fs.promises.readFile(stored);
}

export async function presignedBlobReadUrl(stored: string) {
  const pathname = blobPathname(stored);
  const signed = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil: Date.now() + 60 * 60 * 1000,
    ...blobCommand(),
  });
  const presigned = await presignUrl(signed, {
    operation: "get",
    pathname,
    access: isPublicBlobUrl(stored) ? "public" : "private",
  });
  return presigned.presignedUrl;
}

export async function blobPlaybackRedirect(stored: string, download: boolean) {
  let target = stored;
  if (!isPublicBlobUrl(stored)) {
    target = await presignedBlobReadUrl(stored);
  }
  if (download && isPublicBlobUrl(stored)) {
    const url = new URL(target);
    url.searchParams.set("download", "1");
    target = url.toString();
  }
  return Response.redirect(target, 302);
}

export function renderOutputPath(id: string, nonce: number) {
  if (blobEnabled() || onVercel()) {
    const dir = path.join("/tmp", "instabot");
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${id}-${nonce}.mp4`);
  }
  return path.join(RENDER_DIR, `${id}-${nonce}.mp4`);
}
