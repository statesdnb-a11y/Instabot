import fs from "node:fs";
import path from "node:path";
import { photoById, type StockPhoto } from "@/lib/photos";
import { DATA_DIR } from "@/lib/paths";

function indexPath() {
  return path.join(DATA_DIR, "photo-index.json");
}

function loadIndex(): StockPhoto[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), "utf8")) as StockPhoto[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((photo) => photo && typeof photo.id === "string")
      .map((photo) => ({
        ...photo,
        pair: photo.pair || photo.username || photo.id,
      }));
  } catch {
    return [];
  }
}

export function findPhoto(id: string) {
  return photoById(id) ?? loadIndex().find((photo) => photo.id === id) ?? null;
}
