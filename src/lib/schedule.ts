import { searchMusic } from "@/lib/audio";
import { PUBLISH_EVERY_MS } from "@/lib/cadence";
import {
  countApproved,
  deleteReel,
  getNextPublishAt,
  oldestApproved,
  patchReel,
  setNextPublishAt,
  videoExists,
  type ReelRow,
} from "@/lib/db";
import { instagramConnected, publishReel } from "@/lib/instagram";

const clock = globalThis as unknown as {
  instabotTimer?: ReturnType<typeof setTimeout>;
  instabotSlotRunning?: boolean;
};

function armTimer() {
  if (clock.instabotTimer) clearTimeout(clock.instabotTimer);
  clock.instabotTimer = undefined;
  const next = getNextPublishAt();
  if (next == null) return;
  const delay = Math.max(0, next - Date.now());
  clock.instabotTimer = setTimeout(() => {
    void fireSlot();
  }, delay);
}

export function armScheduler() {
  if (countApproved() === 0) {
    setNextPublishAt(null);
    if (clock.instabotTimer) clearTimeout(clock.instabotTimer);
    clock.instabotTimer = undefined;
    return;
  }
  if (getNextPublishAt() == null) {
    setNextPublishAt(Date.now() + PUBLISH_EVERY_MS);
  }
  armTimer();
}

function advanceSlot() {
  if (countApproved() === 0) setNextPublishAt(null);
  else setNextPublishAt(Date.now() + PUBLISH_EVERY_MS);
  armTimer();
}

async function publishDue(reel: ReelRow) {
  if (reel.render_status !== "ready" || !videoExists(reel) || !reel.video_path) {
    patchReel(reel.id, {
      post_state: "failed",
      post_error: "The silent reel file was not ready for this slot.",
      updated_at: Date.now(),
    });
    return;
  }
  if (!instagramConnected()) {
    patchReel(reel.id, {
      post_state: "not_connected",
      post_error: null,
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
      patchReel(reel.id, {
        post_state: "failed",
        post_error: error,
        updated_at: Date.now(),
      });
      return;
    }
    audioId = track.id;
    patchReel(reel.id, {
      audio_id: track.id,
      audio_title: track.title,
      audio_artist: track.artist,
      audio_artwork_url: track.artworkUrl,
      audio_preview_url: track.previewUrl,
      audio_duration_ms: track.durationMs,
      updated_at: Date.now(),
    });
  }

  const result = await publishReel(reel.video_path, reel.caption, audioId);
  if (result.state === "posted") {
    deleteReel(reel.id);
    return;
  }
  if (result.state === "not_connected") {
    patchReel(reel.id, {
      post_state: "not_connected",
      post_error: null,
      updated_at: Date.now(),
    });
    return;
  }
  patchReel(reel.id, {
    post_state: "failed",
    post_error: result.error,
    updated_at: Date.now(),
  });
}

async function fireSlot() {
  if (clock.instabotSlotRunning) return;
  clock.instabotSlotRunning = true;
  try {
    const reel = oldestApproved();
    if (!reel) {
      setNextPublishAt(null);
      return;
    }
    try {
      await publishDue(reel);
    } catch (error) {
      patchReel(reel.id, {
        post_state: "failed",
        post_error: error instanceof Error ? error.message : "Instagram could not be reached.",
        updated_at: Date.now(),
      });
    }
    advanceSlot();
  } finally {
    clock.instabotSlotRunning = false;
  }
}
