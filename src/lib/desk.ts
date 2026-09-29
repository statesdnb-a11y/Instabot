import fs from "node:fs";
import path from "node:path";
import { captionUsedOnCard, learnLine, rememberCaption } from "@/lib/captions";
import { getNextPublishAt, getReel, listReels, patchReel, videoExists, type ReelRow } from "@/lib/db";
import { instagramConnected } from "@/lib/instagram";
import { armScheduler } from "@/lib/schedule";
import { PHOTO_DIR, RENDER_DIR } from "@/lib/paths";
import { DRAFT_TARGET, fillQueue, markForRender } from "@/lib/queue";
import type { CatalogTrack, DeskPayload, Motion, ReelDTO } from "@/lib/types";
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

export function toReelDTO(row: ReelRow): ReelDTO {
  const hasFile = videoExists(row);
  const inSync =
    row.render_status === "ready" &&
    hasFile &&
    row.rendered_line === row.line &&
    row.rendered_motion === row.motion;
  return {
    id: row.id,
    status: row.status,
    line: row.line,
    caption: row.caption,
    captionCustom: row.caption_custom === 1,
    usedBefore: captionUsedOnCard(row.id, row.status, row.caption),
    photo: {
      id: row.photo_id,
      author: row.photo_author,
      username: row.photo_username,
      sourceUrl: row.photo_source_url,
      license: row.photo_license,
      licenseUrl: row.photo_license_url,
    },
    audio: audioDto(row),
    motion: row.motion,
    durationSec: row.duration_sec,
    renderStatus: row.render_status,
    renderError: row.render_error,
    videoUrl: hasFile ? `/api/reels/${row.id}/video?v=${row.rendered_at ?? row.updated_at}` : null,
    posterUrl: `/api/reels/${row.id}/poster`,
    inSync,
    postState: row.post_state,
    postError: row.post_error,
    igMediaId: row.ig_media_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    approvedAt: row.approved_at,
    postedAt: row.posted_at,
  };
}

export function deskPayload(): DeskPayload {
  return {
    reels: listReels().map(toReelDTO),
    instagramConnected: instagramConnected(),
    draftTarget: DRAFT_TARGET,
    nextPublishAt: getNextPublishAt(),
  };
}

function requireDraft(id: string) {
  const reel = getReel(id);
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

export function updateDraft(
  id: string,
  input: { line?: unknown; caption?: unknown; captionCustom?: unknown },
) {
  const reel = requireDraft(id);
  const line = input.line === undefined ? reel.line : cleanText(input.line, MAX_LINE, "The line");
  const captionCustom = Boolean(input.captionCustom);
  const caption = captionCustom
    ? cleanText(input.caption ?? reel.caption, MAX_CAPTION, "The caption")
    : line;
  const lineChanged = line !== reel.line;
  patchReel(id, {
    line,
    caption,
    caption_custom: captionCustom ? 1 : 0,
    updated_at: Date.now(),
  });
  if (lineChanged) {
    markForRender(id);
    learnLine(line);
  }
  const next = getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

function httpsOrNull(value: unknown) {
  return typeof value === "string" && value.startsWith("https://") ? value : null;
}

export function setAudio(id: string, audio: unknown) {
  requireDraft(id);
  if (!audio || typeof audio !== "object") throw new DeskError("Pick a track.", 400);
  const raw = audio as Record<string, unknown>;
  const audioId = typeof raw.id === "string" ? raw.id.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const artist = typeof raw.artist === "string" ? raw.artist.trim() : "";
  if (!audioId || !title) throw new DeskError("That track is missing a title.", 400);
  patchReel(id, {
    audio_id: audioId,
    audio_title: title,
    audio_artist: artist,
    audio_artwork_url: httpsOrNull(raw.artworkUrl),
    audio_preview_url: httpsOrNull(raw.previewUrl),
    audio_duration_ms: typeof raw.durationMs === "number" ? raw.durationMs : null,
    updated_at: Date.now(),
  });
  const next = getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

export function regenerateLine(id: string) {
  const reel = requireDraft(id);
  const line = nextLine([reel.line]);
  patchReel(id, {
    line,
    caption: reel.caption_custom ? reel.caption : line,
    updated_at: Date.now(),
  });
  markForRender(id);
  const next = getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

export function regenerateMotion(id: string) {
  const reel = requireDraft(id);
  const motion: Motion = reel.motion === "zoom" ? "pan" : "zoom";
  patchReel(id, { motion, updated_at: Date.now() });
  markForRender(id);
  const next = getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

export function retryRender(id: string) {
  const reel = requireDraft(id);
  if (reel.render_status === "rendering" || reel.render_status === "pending") {
    return toReelDTO(reel);
  }
  markForRender(id);
  const next = getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

export function skipReel(id: string) {
  const reel = getReel(id);
  if (!reel) throw new DeskError("That reel is no longer on the desk.", 404);
  if (reel.status !== "draft") throw new DeskError("Only a draft can be skipped.", 409);
  patchReel(id, { status: "skipped", updated_at: Date.now() });
  fillQueue(0);
  return { ok: true };
}

function assertReadyToPost(reel: ReelRow) {
  const dto = toReelDTO(reel);
  if (!dto.inSync) {
    throw new DeskError("Render the latest line and motion before this can be posted.", 409);
  }
  if (!reel.video_path) {
    throw new DeskError("This reel has no video file yet.", 409);
  }
  return reel.video_path;
}

export function approveReel(id: string) {
  const reel = getReel(id);
  if (!reel) throw new DeskError("That reel is no longer on the desk.", 404);
  if (reel.status === "approved") return toReelDTO(reel);
  if (reel.status !== "draft") {
    throw new DeskError("This reel can't be approved from here.", 409);
  }
  assertReadyToPost(reel);
  rememberCaption(reel.caption);
  const now = Date.now();
  patchReel(id, {
    status: "approved",
    approved_at: now,
    post_state: null,
    post_error: null,
    updated_at: now,
  });
  armScheduler();
  fillQueue(0);
  const next = getReel(id);
  if (!next) throw new DeskError("That reel is no longer on the desk.", 404);
  return toReelDTO(next);
}

function insideDir(filePath: string, dir: string) {
  const root = path.resolve(dir);
  const resolved = path.resolve(filePath);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export function reelMedia(id: string, kind: "video" | "poster") {
  const reel = getReel(id);
  if (!reel) return null;
  if (kind === "poster") {
    const file = path.join(PHOTO_DIR, reel.photo_file);
    if (!insideDir(file, PHOTO_DIR) || !fs.existsSync(file)) return null;
    return { file, type: "image/jpeg" as const, downloadName: null };
  }
  if (!reel.video_path || !insideDir(reel.video_path, RENDER_DIR) || !fs.existsSync(reel.video_path)) {
    return null;
  }
  return {
    file: reel.video_path,
    type: "video/mp4" as const,
    downloadName: `instabot-${reel.id}.mp4`,
  };
}
