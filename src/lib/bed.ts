import fs from "node:fs";
import path from "node:path";
import { claimBedTrack, listReels, patchReel, takeNextBedTrack, undoBedTrackTake } from "@/lib/db";
import {
  blobEnabled,
  onVercel,
  readVideoBytes,
  removeStoredVideo,
  safeMediaError,
  saveRenderedMp4,
  videoExists,
} from "@/lib/media";
import { RENDER_DIR } from "@/lib/paths";
import { muxBedAudio } from "@/lib/render";

export async function attachMissingBedAudio() {
  const reels = await listReels();
  for (const reel of reels) {
    if (reel.bed_track || reel.render_status !== "ready" || !reel.video_path || !videoExists(reel)) continue;
    const taken = await takeNextBedTrack(reel.bed_track);
    const track = { id: taken.id };
    const claimed = await claimBedTrack(reel.id, track.id);
    if (!claimed) {
      await undoBedTrackTake(taken);
      continue;
    }
    const name = `${reel.id}-bed-${track.id}-${Date.now()}.mp4`;
    const dir = blobEnabled() || onVercel() ? path.join("/tmp", "instabot") : RENDER_DIR;
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, `${reel.id}-src.mp4`);
    const dest = path.join(dir, name);
    try {
      await fs.promises.writeFile(src, await readVideoBytes(reel.video_path));
      await muxBedAudio(src, track.id, dest);
      const stored = await saveRenderedMp4(dest, name);
      await patchReel(reel.id, {
        video_path: stored,
        rendered_at: Date.now(),
        render_error: null,
        updated_at: Date.now(),
      });
      if (reel.video_path !== stored) await removeStoredVideo(reel.video_path);
    } catch (error) {
      fs.rmSync(dest, { force: true });
      await undoBedTrackTake(taken);
      await patchReel(reel.id, {
        bed_track: null,
        render_error: safeMediaError(error),
        updated_at: Date.now(),
      });
    } finally {
      fs.rmSync(src, { force: true });
    }
  }
}
