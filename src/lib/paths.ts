import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const PHOTO_DIR = path.join(DATA_DIR, "photos");
export const RENDER_DIR = path.join(DATA_DIR, "renders");
export const DB_PATH = path.join(DATA_DIR, "instabot.db");

export function ensureDataDirs() {
  fs.mkdirSync(PHOTO_DIR, { recursive: true });
  fs.mkdirSync(RENDER_DIR, { recursive: true });
}
