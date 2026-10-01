import fs from "node:fs";
import path from "node:path";
import { attachMissingBedAudio } from "@/lib/bed";
import {
  countDrafts,
  draftLines,
  getReel,
  getSql,
  insertReel,
  listReels,
  patchReel,
  purgePublished,
  noteChosenBedTrack,
  takeNextBedTrack,
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
import { ensureDataDirs, resolvePhotoFile } from "@/lib/paths";
import { CaptionError } from "@/lib/captions";
import { findPhoto, takeStudioPhoto } from "@/lib/photo-search";
import { STILL_GONE, renderReelFile } from "@/lib/render";
import { bedTrackById } from "@/lib/tracks";
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
    bed_track: (await takeNextBedTrack()).id,
    motion: await pickMotion(),
    duration_sec: 15,
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
  bedTrack?: string;
  caption: string;
  manual: boolean;
}) {
  const photo = findPhoto(input.photoId);
  if (!photo) throw new CaptionError("Pick one of the stills.");
  const caption = input.caption.trim();
  if (!caption) throw new CaptionError("Write a caption, or generate one.");
  if (caption.length > 220) throw new CaptionError("That caption is too long.");
  const chosen = input.bedTrack ? bedTrackById(input.bedTrack) : null;
  const track = chosen ?? bedTrackById((await takeNextBedTrack()).id);
  if (!track) throw new CaptionError("Pick Music 1 through Music 9.");
  if (chosen) await noteChosenBedTrack(chosen.id);
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
    duration_sec: 15,
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
      durationSec: 15,
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
      duration_sec: 15,
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

function localStillFile(file: string | null) {
  if (!file || isPublicBlobUrl(file)) return null;
  if (path.isAbsolute(file) && fs.existsSync(file)) return file;
  return resolvePhotoFile(file);
}

function siblingStillUrls(reel: ReelRow) {
  if (!reel.video_path || !isPublicBlobUrl(reel.video_path)) return [];
  let origin: string;
  try {
    origin = new URL(reel.video_path).origin;
  } catch {
    return [];
  }
  const ids = new Set<string>();
  if (/^\d+$/.test(reel.photo_id)) ids.add(reel.photo_id);
  const fromFile = /^studio-(\d+)\.jpg$/.exec(path.basename(reel.photo_file))?.[1];
  if (fromFile) ids.add(fromFile);
  return [...ids].map((id) => `${origin}/stills/${id}.jpg`);
}

async function publicJpegReady(url: string) {
  if (!isPublicBlobUrl(url)) return false;
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
    if (!response.ok) return false;
    const type = response.headers.get("content-type") ?? "";
    const length = Number(response.headers.get("content-length") ?? "0");
    return type.includes("jpeg") || type.includes("jpg") || length >= 8000;
  } catch {
    return false;
  }
}

async function clearStaleStillError(reel: ReelRow) {
  if (reel.render_error !== STILL_GONE) return;
  const linesMatch = reel.rendered_line === reel.line && reel.rendered_motion === reel.motion;
  await patchReel(reel.id, {
    render_error: null,
    render_status: reel.video_path && linesMatch ? "ready" : reel.render_status,
    updated_at: Date.now(),
  });
}

/** Remember a public blob URL, or a local file reference when Blob is unset. */
export async function ensureReelStill(reel: ReelRow) {
  const urls = [reel.still_url, findPhoto(reel.photo_id)?.imageUrl, ...siblingStillUrls(reel)].filter(
    (url): url is string => Boolean(url),
  );
  const seen = new Set<string>();
  for (const url of urls) {
    if (!isPublicBlobUrl(url) || seen.has(url)) continue;
    seen.add(url);
    if (!(await publicJpegReady(url))) continue;
    if (reel.still_url !== url) {
      await patchReel(reel.id, { still_url: url, updated_at: Date.now() });
    }
    const next = await getReel(reel.id);
    if (next) await clearStaleStillError(next);
    return;
  }

  const local = localStillFile(reel.photo_file) ?? localStillFile(reel.still_url);
  if (!local) throw new Error(STILL_GONE);
  if (blobEnabled()) {
    const imageUrl = await saveStillJpeg(reel.photo_id, fs.readFileSync(local)).catch(() => null);
    if (!imageUrl) {
      if (onVercel()) throw new Error("The still could not be stored for a later edit.");
    } else if (reel.still_url !== imageUrl) {
      await patchReel(reel.id, { still_url: imageUrl, updated_at: Date.now() });
      const next = await getReel(reel.id);
      if (next) await clearStaleStillError(next);
      return;
    } else {
      return;
    }
  }
  const reference = path.basename(local);
  if (reel.still_url !== reference) {
    await patchReel(reel.id, { still_url: reference, updated_at: Date.now() });
  }
}

export async function stillIsMissing(reel: ReelRow) {
  try {
    await ensureReelStill(reel);
    return false;
  } catch (error) {
    return !(error instanceof Error) || error.message === STILL_GONE;
  }
}

async function materializeReelStill(reel: ReelRow) {
  await ensureReelStill(reel);
  const fresh = (await getReel(reel.id)) ?? reel;
  if (fresh.still_url && isPublicBlobUrl(fresh.still_url)) {
    const response = await fetch(fresh.still_url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(STILL_GONE);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 8000 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error(STILL_GONE);
    const dest = path.join(path.dirname(renderOutputPath(fresh.id, fresh.render_nonce)), `still-${fresh.id}.jpg`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, bytes);
    return { path: dest, temporary: true };
  }
  const local = localStillFile(fresh.still_url) ?? localStillFile(fresh.photo_file);
  if (!local) throw new Error(STILL_GONE);
  return { path: local, temporary: false };
}

async function rememberDeskStills() {
  for (const reel of await listReels()) {
    try {
      await ensureReelStill(reel);
    } catch {
      // A reel with no readable JPEG stays missing on its card.
    }
  }
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
  await rememberDeskStills();
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
