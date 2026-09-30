import fs from "node:fs";
import path from "node:path";

const bundledData = path.join(process.cwd(), "data");
const scratch = path.join("/tmp", "instabot");

function onVercel() {
  return process.env.VERCEL === "1";
}

function tursoConfigured() {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

/** Bundled stills. Read-only on Vercel. Never create this directory there. */
export const PHOTO_DIR = path.join(bundledData, "photos");

export const DATA_DIR = onVercel() ? scratch : bundledData;

export const RENDER_DIR = onVercel() ? path.join(scratch, "renders") : path.join(bundledData, "renders");

export const DB_PATH =
  onVercel() && !tursoConfigured() ? path.join(scratch, "instabot.db") : path.join(bundledData, "instabot.db");

/** Downloaded stills. On Vercel this is scratch space; the bundled set stays in PHOTO_DIR. */
export const PHOTO_CACHE_DIR = path.join(DATA_DIR, "photos");

export function resolvePhotoFile(file: string) {
  const name = path.basename(file);
  if (!name || name !== file) return null;
  const cached = path.resolve(PHOTO_CACHE_DIR, name);
  const cacheRoot = path.resolve(PHOTO_CACHE_DIR);
  if (cached.startsWith(`${cacheRoot}${path.sep}`) && fs.existsSync(cached)) return cached;
  const bundled = path.resolve(PHOTO_DIR, name);
  const bundledRoot = path.resolve(PHOTO_DIR);
  if (bundled.startsWith(`${bundledRoot}${path.sep}`) && fs.existsSync(bundled)) return bundled;
  return null;
}

export function ensureDataDirs() {
  fs.mkdirSync(PHOTO_CACHE_DIR, { recursive: true });
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  if (!onVercel() || !tursoConfigured()) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
