import fs from "node:fs";
import path from "node:path";
import { captionUsedOnCard, learnLine, rememberCaption } from "@/lib/captions";
import { getReel, listReels, patchReel, type ReelRow } from "@/lib/db";
import { instagramConnected } from "@/lib/instagram";
import { instagramDesk } from "@/lib/meta";
import { isPublicBlobUrl, onVercel, presignedBlobReadUrl, safeMediaError, storedVideoKind, videoExists } from "@/lib/media";
import { PHOTO_DIR, RENDER_DIR, resolvePhotoFile } from "@/lib/paths";
import { publishApprovedNow } from "@/lib/publish";
import { DRAFT_TARGET, fillQueue, markForRender } from "@/lib/queue";
import { STILL_GONE } from "@/lib/render";
import type { CatalogTrack, DeskPayload, Motion, ReelDTO } from "@/lib/types";
import { bedTrackById } from "@/lib/tracks";
import { nextLine } from "@/lib/voice";

const MAX_LINE = 220;
const MAX_CAPTION = 2200;

function audioDto(row: ReelRow): CatalogTrack | null {
  if (!row.audio_id || !row.audio_title) return null;
  return {
    id: row.audio_id,
    title: row.audio_title,
    artist: row.audio_artist ?? "",
    artworkUrl: row.audio_artwork_url,
    previewUrl: row.audio_preview_url,
    durationMs: row.audio_duration_ms,
  };
}

async function clientVideoUrl(row: ReelRow) {
  const kind = storedVideoKind(row.video_path);
  if (kind === "public-blob") return { url: row.video_path, error: null as string | null };
  if (kind === "private-blob" && row.video_path) {
    try {
      return { url: await presignedBlobReadUrl(row.video_path), error: null as string | null };
    } catch (error) {
      return { url: null, error: safeMediaError(error) };
    }
  }
  if (kind === "missing") return { url: null, error: null as string | null };
  return {
    url: `/api/reels/${row.id}/video?v=${row.rendered_at ?? row.updated_at}`,
    error: null as string | null,
  };
}

export async function toReelDTO(row: ReelRow): Promise<ReelDTO> {
  const hasFile = videoExists(row);
  const inSync =
    row.render_status === "ready" &&
    hasFile &&
    row.rendered_line === row.line &&
    row.rendered_motion === row.motion;
  const playback = await clientVideoUrl(row);
  const renderError =
    row.render_error ??
    playback.error ??
    (row.render_status === "ready" && row.video_path && !hasFile
      ? "The mp4 is not in storage anymore. Cut this reel again."
      : null);
  return {
    id: row.id,
    status: row.status,
    line: row.line,
    caption: row.caption,
    captionCustom: row.caption_custom === 1,
    usedBefore: await captionUsedOnCard(row.id, row.status, row.caption),
    photo: {
      id: row.photo_id,
      author: row.photo_author,
      username: row.photo_username,
      sourceUrl: row.photo_source_url,
      license: row.photo_license,
      licenseUrl: row.photo_license_url,
    },
    audio: audioDto(row),
    bedLabel: bedTrackById(row.bed_track)?.label ?? null,
    motion: row.motion,
    durationSec: row.duration_sec,
    renderStatus: row.render_status,
    renderError,
    videoUrl: playback.url,
    posterUrl: `/api/reels/${row.id}/poster`,
    inSync,
    postState: row.post_state,
    postError: row.post_error,
    igMediaId: row.ig_media_id,
    stillMissing: reelStillMissing(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    postedAt: row.posted_at,
  };
}

export async function deskPayload(): Promise<DeskPayload> {
  const reels = await listReels();
  return {
    reels: await Promise.all(reels.map((row) => toReelDTO(row))),
    instagramConnected: await instagramConnected(),
    instagram: await instagramDesk(),
    draftTarget: DRAFT_TARGET,
  };
}

async function requireDraft(id: string) {
  const reel = await getReel(id);
  if (!reel) throw new DeskError("That reel is no longer on the desk.", 404);
  if (reel.status !== "draft") throw new DeskError("Only a draft can be changed.", 409);
  return reel;
}

export class DeskError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function cleanText(value: unknown, max: number, label: string) {
  if (typeof value !== "string") throw new DeskError(`${label} needs words.`, 400);
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) throw new DeskError(`${label} can't be empty.`, 400);
  if (text.length > max) throw new DeskError(`${label} is too long.`, 400);
  return text;
}

export async function updateDraft(
  id: string,
  input: { line?: unknown; caption?: unknown; captionCustom?: unknown },
) {
  const reel = await requireDraft(id);
  const line = input.line === undefined ? reel.line : cleanText(input.line, MAX_LINE, "The line");
  const captionCustom = Boolean(input.captionCustom);
  const caption = captionCustom
    ? cleanText(input.caption ?? reel.caption, MAX_CAPTION, "The caption")
    : line;
  const lineChanged = line !== reel.line;
  if (lineChanged && reelStillMissing(reel)) throw new DeskError(STILL_GONE, 409);
  await patchReel(id, {
    line,
    caption,
    caption_custom: captionCustom ? 1 : 0,
    updated_at: Date.now(),
  });
  if (lineChanged) {
    await rerenderOrRestore(id, reel);
    await learnLine(line);
  }
  const next = await getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

function httpsOrNull(value: unknown) {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

export async function setAudio(id: string, audio: unknown) {
  await requireDraft(id);
  if (!audio || typeof audio !== "object") throw new DeskError("Pick a track.", 400);
  const raw = audio as Record<string, unknown>;
  const audioId = typeof raw.id === "string" ? raw.id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const artist = typeof raw.artist === "string" ? raw.artist.trim() : "";
  if (!audioId || !title) throw new DeskError("That track is missing a title.", 400);
  await patchReel(id, {
    audio_id: audioId,
    audio_title: title,
    audio_artist: artist,
    audio_artwork_url: httpsOrNull(raw.artworkUrl),
    audio_preview_url: httpsOrNull(raw.previewUrl),
    audio_duration_ms: typeof raw.durationMs === "number" ? raw.durationMs : null,
    updated_at: Date.now(),
  });
  const next = await getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

export async function regenerateLine(id: string) {
  const reel = await requireDraft(id);
  if (reelStillMissing(reel)) throw new DeskError(STILL_GONE, 409);
  const line = await nextLine([reel.line]);
  await patchReel(id, {
    line,
    caption: reel.caption_custom ? reel.caption : line,
    updated_at: Date.now(),
  });
  await rerenderOrRestore(id, reel);
  const next = await getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

export async function regenerateMotion(id: string) {
  const reel = await requireDraft(id);
  if (reelStillMissing(reel)) throw new DeskError(STILL_GONE, 409);
  const motion: Motion = reel.motion === "zoom" ? "pan" : "zoom";
  await patchReel(id, { motion, updated_at: Date.now() });
  await rerenderOrRestore(id, reel);
  const next = await getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

export async function retryRender(id: string) {
  const reel = await requireDraft(id);
  if (reelStillMissing(reel)) throw new DeskError(STILL_GONE, 409);
  if (reel.render_status === "rendering" || reel.render_status === "pending") {
    return toReelDTO(reel);
  }
  await markForRender(id);
  const next = await getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

export async function skipReel(id: string) {
  const reel = await getReel(id);
  if (!reel) throw new DeskError("That reel is no longer on the desk.", 404);
  if (reel.status !== "draft") throw new DeskError("Only a draft can be skipped.", 409);
  await patchReel(id, { status: "skipped", updated_at: Date.now() });
  if (!onVercel()) void fillQueue(0).catch(() => undefined);
  return { ok: true };
}

async function assertReadyToPost(reel: ReelRow) {
  const dto = await toReelDTO(reel);
  if (!dto.inSync) {
    throw new DeskError("Render the latest line and motion before this can be posted.", 409);
  }
  if (!reel.video_path) {
    throw new DeskError("This reel has no video file yet.", 409);
  }
}

async function finishPublish(id: string) {
  const removed = await publishApprovedNow(id);
  if (removed) return { removed: true as const };
  const next = await getReel(id);
  if (!next) return { removed: true as const };
  return toReelDTO(next);
}

export async function approveReel(id: string) {
  const reel = await getReel(id);
  if (!reel) throw new DeskError("That reel is no longer on the desk.", 404);
  if (reel.status === "approved") return toReelDTO(reel);
  if (reel.status !== "draft") {
    throw new DeskError("This reel can't be approved from here.", 409);
  }
  await assertReadyToPost(reel);
  await rememberCaption(reel.caption);
  const now = Date.now();
  await patchReel(id, {
    status: "approved",
    approved_at: now,
    post_state: null,
    post_error: null,
    updated_at: now,
  });
  const result = await finishPublish(id);
  if (!onVercel()) void fillQueue(0).catch(() => undefined);
  return result;
}

export async function retryPublish(id: string) {
  const reel = await getReel(id);
  if (!reel) throw new DeskError("That reel is no longer on the desk.", 404);
  if (reel.status !== "approved") throw new DeskError("Only an approved reel can be posted again.", 409);
  return finishPublish(id);
}

function reelStillMissing(row: ReelRow) {
  if (row.still_url && isPublicBlobUrl(row.still_url)) return false;
  return !resolvePhotoFile(row.photo_file);
}

async function rerenderOrRestore(id: string, previous: ReelRow) {
  try {
    await markForRender(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : STILL_GONE;
    if (message !== STILL_GONE) throw error;
    await patchReel(id, {
      line: previous.line,
      caption: previous.caption,
      caption_custom: previous.caption_custom,
      motion: previous.motion,
      render_status: previous.render_status,
      render_error: STILL_GONE,
      render_nonce: previous.render_nonce,
      video_path: previous.video_path,
      rendered_line: previous.rendered_line,
      rendered_motion: previous.rendered_motion,
      rendered_at: previous.rendered_at,
      updated_at: Date.now(),
    });
    throw new DeskError(STILL_GONE, 409);
  }
}

function insideDir(filePath: string, dir: string) {
  const root = path.resolve(dir);
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export async function reelMedia(id: string, kind: "video" | "poster") {
  const reel = await getReel(id);
  if (!reel) return null;
  if (kind === "poster") {
    const file = path.join(PHOTO_DIR, reel.photo_file);
    if (!insideDir(file, PHOTO_DIR) || !fs.existsSync(file)) return null;
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
