import fs from "node:fs";
import path from "node:path";
import { attachMissingBedAudio } from "@/lib/bed";
import {
  countDrafts,
  draftLines,
  getReel,
  getSql,
  insertReel,
  patchReel,
  purgePublished,
  usageCounts,
  type ReelRow,
} from "@/lib/db";
import {
  blobEnabled,
  isPublicBlobUrl,
  onVercel,
  removeStoredVideo,
  renderOutputPath,
  safeMediaError,
  saveRenderedMp4,
  saveStillJpeg,
} from "@/lib/media";
import { PHOTO_DIR, ensureDataDirs, resolvePhotoFile } from "@/lib/paths";
import { CaptionError } from "@/lib/captions";
import { findPhoto, takeStudioPhoto } from "@/lib/photo-search";
import { STILL_GONE, renderReelFile } from "@/lib/render";
import { bedTrackById, pickBedTrack } from "@/lib/tracks";
import type { Motion } from "@/lib/types";
import { nextLine } from "@/lib/voice";

export const DRAFT_TARGET = 5;

const globalQueue = globalThis as unknown as {
  instabotBoot?: Promise<void>;
  instabotPumping?: boolean;
  instabotQueued?: Set<string>;
};

function queued() {
  if (!globalQueue.instabotQueued) globalQueue.instabotQueued = new Set();
  return globalQueue.instabotQueued;
}

async function pickMotion(): Promise<Motion> {
  const counts = await usageCounts("motion");
  const zoom = counts.get("zoom") ?? 0;
  const pan = counts.get("pan") ?? 0;
  if (zoom === pan) return Math.random() < 0.5 ? "zoom" : "pan";
  return zoom < pan ? "zoom" : "pan";
}

export async function createDraft() {
  const now = Date.now();
  const photo = await takeStudioPhoto();
  const line = await nextLine(await draftLines());
  const row: ReelRow = {
    id: crypto.randomUUID(),
    status: "draft",
    line,
    caption: line,
    caption_custom: 0,
    photo_id: photo.id,
    photo_author: photo.author,
    photo_username: photo.username,
    photo_source_url: photo.sourceUrl,
    photo_license: photo.license,
    photo_license_url: photo.licenseUrl,
    photo_file: photo.file,
    still_url: publicStillUrl(photo.imageUrl),
    audio_id: null,
    audio_title: null,
    audio_artist: null,
    audio_artwork_url: null,
    audio_preview_url: null,
    audio_duration_ms: null,
    bed_track: pickBedTrack().id,
    motion: await pickMotion(),
    duration_sec: 8 + Math.floor(Math.random() * 5),
    video_path: null,
    render_status: "pending",
    render_error: null,
    render_nonce: 1,
    rendered_line: null,
    rendered_motion: null,
    rendered_at: null,
    post_state: null,
    post_error: null,
    ig_media_id: null,
    created_at: now,
    updated_at: now,
    approved_at: null,
    posted_at: null,
  };
  await insertReel(row);
  return row.id;
}

export async function createStudioReel(input: {
  photoId: string;
  bedTrack: string;
  caption: string;
  manual: boolean;
}) {
  const photo = findPhoto(input.photoId);
  if (!photo) throw new CaptionError("Pick one of the stills.");
  const track = bedTrackById(input.bedTrack);
  if (!track) throw new CaptionError("Pick Music 1, Music 2, Music 3, or Music 4.");
  const caption = input.caption.trim();
  if (!caption) throw new CaptionError("Write a caption, or generate one.");
  if (caption.length > 220) throw new CaptionError("That caption is too long.");
  const now = Date.now();
  const row: ReelRow = {
    id: crypto.randomUUID(),
    status: "draft",
    line: caption,
    caption,
    caption_custom: input.manual ? 1 : 0,
    photo_id: photo.id,
    photo_author: photo.author,
    photo_username: photo.username,
    photo_source_url: photo.sourceUrl,
    photo_license: photo.license,
    photo_license_url: photo.licenseUrl,
    photo_file: photo.file,
    still_url: publicStillUrl(photo.imageUrl),
    audio_id: null,
    audio_title: null,
    audio_artist: null,
    audio_artwork_url: null,
    audio_preview_url: null,
    audio_duration_ms: null,
    bed_track: track.id,
    motion: await pickMotion(),
    duration_sec: 8 + Math.floor(Math.random() * 5),
    video_path: null,
    render_status: "pending",
    render_error: null,
    render_nonce: 1,
    rendered_line: null,
    rendered_motion: null,
    rendered_at: null,
    post_state: null,
    post_error: null,
    ig_media_id: null,
    created_at: now,
    updated_at: now,
    approved_at: null,
    posted_at: null,
  };
  await insertReel(row);
  return row.id;
}

export function enqueueRender(id: string) {
  queued().add(id);
  void pump();
}

async function pump() {
  if (globalQueue.instabotPumping) return;
  globalQueue.instabotPumping = true;
  try {
    while (queued().size > 0) {
      const id = queued().values().next().value as string;
      queued().delete(id);
      try {
        await renderOne(id);
      } catch {
        // renderOne already stored the message on the row.
      }
    }
  } finally {
    globalQueue.instabotPumping = false;
    if (queued().size > 0) void pump();
  }
}

export async function renderOne(id: string) {
  const reel = await getReel(id);
  if (!reel || reel.status !== "draft") return;
  const nonce = reel.render_nonce;
  await patchReel(id, {
    render_status: "rendering",
    render_error: null,
    updated_at: Date.now(),
  });

  const outputPath = renderOutputPath(id, nonce);
  let removedPrevious = false;
  let temporaryStill: string | null = null;
  try {
    const still = await materializeReelStill(reel);
    temporaryStill = still.temporary ? still.path : null;
    await renderReelFile({
      photoFile: reel.photo_file,
      photoPath: still.path,
      line: reel.line,
      motion: reel.motion,
      durationSec: reel.duration_sec,
      outputPath,
      bedTrack: reel.bed_track,
    });
    const current = await getReel(id);
    if (!current || current.render_nonce !== nonce || current.status !== "draft") {
      fs.rmSync(outputPath, { force: true });
      if (current?.status === "draft") enqueueRender(id);
      return;
    }
    if (current.video_path && current.video_path !== outputPath) {
      removedPrevious = true;
      await removeStoredVideo(current.video_path);
    }
    const stored = await saveRenderedMp4(outputPath, `${id}-${nonce}.mp4`);
    await patchReel(id, {
      video_path: stored,
      render_status: "ready",
      render_error: null,
      rendered_line: current.line,
      rendered_motion: current.motion,
      rendered_at: Date.now(),
      updated_at: Date.now(),
    });
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    const current = await getReel(id);
    const message = safeMediaError(error);
    if (!current || current.render_nonce !== nonce) {
      if (current?.status === "draft") enqueueRender(id);
      return;
    }
    await patchReel(id, {
      render_status: "error",
      render_error: message,
      video_path: removedPrevious ? null : current.video_path,
      updated_at: Date.now(),
    });
    throw new Error(message);
  } finally {
    if (temporaryStill) fs.rmSync(temporaryStill, { force: true });
  }
}

function publicStillUrl(value: string | undefined) {
  return value && isPublicBlobUrl(value) ? value : null;
}

function bundledStill(file: string) {
  const root = path.resolve(PHOTO_DIR);
  const resolved = path.resolve(file);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

async function materializeReelStill(reel: ReelRow) {
  if (reel.still_url && isPublicBlobUrl(reel.still_url)) {
    const response = await fetch(reel.still_url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(STILL_GONE);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 8000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(STILL_GONE);
    const dest = path.join(path.dirname(renderOutputPath(reel.id, reel.render_nonce)), `still-${reel.id}.jpg`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    return { path: dest, temporary: true };
  }

  const local = resolvePhotoFile(reel.photo_file);
  if (!local) throw new Error(STILL_GONE);
  if (blobEnabled()) {
    const imageUrl = await saveStillJpeg(reel.photo_id, fs.readFileSync(local)).catch(() => null);
    if (imageUrl) {
      await patchReel(reel.id, { still_url: imageUrl, updated_at: Date.now() });
    } else if (onVercel() && !bundledStill(local)) {
      throw new Error("The still could not be stored for a later edit.");
    }
  }
  return { path: local, temporary: false };
}

export async function markForRender(id: string) {
  const reel = await getReel(id);
  if (!reel || reel.status !== "draft") return null;
  queued().delete(id);
  const next = await patchReel(id, {
    render_nonce: reel.render_nonce + 1,
    render_status: "pending",
    render_error: null,
    updated_at: Date.now(),
  });
  await renderOne(id);
  return next ?? null;
}

async function createDrafts(extra = 0) {
  const need = Math.max(0, DRAFT_TARGET - (await countDrafts())) + extra;
  const ids: string[] = [];
  for (let i = 0; i < need; i += 1) ids.push(await createDraft());
  return ids;
}

export async function fillQueue(extra = 0) {
  const ids = await createDrafts(extra);
  for (const id of ids) await renderOne(id);
  return ids;
}

async function runBoot() {
  ensureDataDirs();
  await purgePublished();
  const db = await getSql();
  await db.run("UPDATE reels SET render_status = 'pending' WHERE status = 'draft' AND render_status = 'rendering'");
  await attachMissingBedAudio();
  if (onVercel()) return;
  await createDrafts(0);
  const pending = await db.all<{ id: string }>(
    "SELECT id FROM reels WHERE status = 'draft' AND render_status = 'pending'",
  );
  for (const row of pending) enqueueRender(row.id);
}

export function bootQueue() {
  if (!globalQueue.instabotBoot) {
    globalQueue.instabotBoot = runBoot().catch((error: unknown) => {
      globalQueue.instabotBoot = undefined;
      throw error;
    });
  }
  return globalQueue.instabotBoot;
}
