import fs from "node:fs";
import path from "node:path";
import { getReel } from "@/lib/db";
import { isPublicBlobUrl, storedVideoKind } from "@/lib/media";
import { RENDER_DIR, resolvePhotoFile } from "@/lib/paths";

function insideDir(filePath: string, dir: string) {
  const root = path.resolve(dir);
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export async function reelMedia(id: string, kind: "video" | "poster") {
  const reel = await getReel(id);
  if (!reel) return null;
  if (kind === "poster") {
    if (reel.still_url && isPublicBlobUrl(reel.still_url)) {
      return { file: null, url: reel.still_url, type: "image/jpeg" as const, downloadName: null };
    }
    const file = resolvePhotoFile(reel.photo_file) ?? resolvePhotoFile(reel.still_url ?? "");
    if (!file) return null;
    return { file, url: null as string | null, type: "image/jpeg" as const, downloadName: null };
  }
  const stored = storedVideoKind(reel.video_path);
  if (!reel.video_path || stored === "missing") return null;
  if (stored === "public-blob" || stored === "private-blob") {
    return {
      file: null as string | null,
      url: reel.video_path,
      type: "video/mp4" as const,
      downloadName: `instabot-${reel.id}.mp4`,
    };
  }
  if (!insideDir(reel.video_path, RENDER_DIR) || !fs.existsSync(reel.video_path)) return null;
  return {
    file: reel.video_path,
    url: null as string | null,
    type: "video/mp4" as const,
    downloadName: `instabot-${reel.id}.mp4`,
  };
}
