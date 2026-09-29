import fs from "node:fs";
import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), "data");
export const PHOTO_DIR = path.join(DATA_DIR, "photos");
export const RENDER_DIR = path.join(DATA_DIR, "renders");
export const DB_PATH = path.join(DATA_DIR, "instabot.db");

export function ensureDataDirs() {
  for (const dir of [PHOTO_DIR, RENDER_DIR]) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "EROFS" && code !== "EACCES" && code !== "EPERM") throw error;
    }
  }
}
