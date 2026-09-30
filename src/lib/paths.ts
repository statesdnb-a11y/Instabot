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

export function ensureDataDirs() {
  if (onVercel()) {
    fs.mkdirSync(RENDER_DIR, { recursive: true });
    if (!tursoConfigured()) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    return;
  }
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
