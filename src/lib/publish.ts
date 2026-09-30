import { searchMusic } from "@/lib/audio";
import { deleteReel, getReel, patchReel, type ReelRow } from "@/lib/db";
import { instagramConnected, publishReel } from "@/lib/instagram";
import { readVideoBytes, videoExists } from "@/lib/media";
import { bedTrackById } from "@/lib/tracks";

export async function publishApprovedNow(id: string) {
  const reel = await getReel(id);
  if (!reel || reel.status !== "approved") return false;
  await publishDue(reel);
  const after = await getReel(id);
  return !after;
}

async function publishDue(reel: ReelRow) {
  if (reel.render_status !== "ready" || !videoExists(reel) || !reel.video_path) {
    await patchReel(reel.id, {
      post_state: "failed",
      post_error: "The reel file was not ready to publish.",
      updated_at: Date.now(),
    });
    return;
  }
  if (!(await instagramConnected())) {
    await patchReel(reel.id, {
      post_state: "not_connected",
      post_error: null,
      updated_at: Date.now(),
    });
    return;
  }

  if (bedTrackById(reel.bed_track)) {
    const bytes = await readVideoBytes(reel.video_path);
    const result = await publishReel(bytes, reel.caption, null, { keepFileAudio: true });
    if (result.state === "posted") {
      await deleteReel(reel.id);
      return;
    }
    if (result.state === "not_connected") {
      await patchReel(reel.id, {
        post_state: "not_connected",
        post_error: null,
        updated_at: Date.now(),
      });
      return;
    }
    await patchReel(reel.id, {
      post_state: "failed",
      post_error: result.error,
      updated_at: Date.now(),
    });
    return;
  }

  let audioId = reel.audio_id;
  if (!audioId) {
    const catalog = await searchMusic();
    const track = catalog.connected ? catalog.tracks[0] : undefined;
    if (!track) {
      const error =
        catalog.connected && catalog.error
          ? catalog.error
          : "Instagram did not return a trending track to attach.";
      await patchReel(reel.id, {
        post_state: "failed",
        post_error: error,
        updated_at: Date.now(),
      });
      return;
    }
    audioId = track.id;
    await patchReel(reel.id, {
      audio_id: track.id,
      audio_title: track.title,
      audio_artist: track.artist,
      audio_artwork_url: track.artworkUrl,
      audio_preview_url: track.previewUrl,
      audio_duration_ms: track.durationMs,
      updated_at: Date.now(),
    });
  }

  const bytes = await readVideoBytes(reel.video_path);
  const result = await publishReel(bytes, reel.caption, audioId);
  if (result.state === "posted") {
    await deleteReel(reel.id);
    return;
  }
  if (result.state === "not_connected") {
    await patchReel(reel.id, {
      post_state: "not_connected",
      post_error: null,
      updated_at: Date.now(),
    });
    return;
  }
  await patchReel(reel.id, {
    post_state: "failed",
    post_error: result.error,
    updated_at: Date.now(),
  });
}
