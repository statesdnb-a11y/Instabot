import fs from "node:fs";
import path from "node:path";
import {
  countDrafts,
  draftLines,
  getDb,
  getReel,
  insertReel,
  patchReel,
  purgePublished,
  usageCounts,
  type ReelRow,
} from "@/lib/db";
import { RENDER_DIR, ensureDataDirs } from "@/lib/paths";
import { PHOTOS, type StockPhoto } from "@/lib/photos";
import { renderReelFile } from "@/lib/render";
import type { Motion } from "@/lib/types";
import { nextLine } from "@/lib/voice";

export const DRAFT_TARGET = 5;

const globalQueue = globalThis as unknown as {
  instabotBooted?: boolean;
  instabotPumping?: boolean;
  instabotQueued?: Set<string>;
};

function queued() {
  if (!globalQueue.instabotQueued) globalQueue.instabotQueued = new Set();
  return globalQueue.instabotQueued;
}

function leastUsed<T extends { id: string }>(items: T[], counts: Map<string, number>) {
  let best = Number.POSITIVE_INFINITY;
  for (const item of items) best = Math.min(best, counts.get(item.id) ?? 0);
  const pool = items.filter((item) => (counts.get(item.id) ?? 0) === best);
  return pool[Math.floor(Math.random() * pool.length)] ?? items[0];
}

function pickMotion(): Motion {
  const counts = usageCounts("motion");
  const zoom = counts.get("zoom") ?? 0;
  const pan = counts.get("pan") ?? 0;
  if (zoom === pan) return Math.random() < 0.5 ? "zoom" : "pan";
  return zoom < pan ? "zoom" : "pan";
}

export function createDraft() {
  const now = Date.now();
  const photo = leastUsed<StockPhoto>(PHOTOS, usageCounts("photo_id"));
  const line = nextLine(draftLines());
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
    audio_id: null,
    audio_title: null,
    audio_artist: null,
    audio_artwork_url: null,
    audio_preview_url: null,
    audio_duration_ms: null,
    motion: pickMotion(),
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
  insertReel(row);
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
      await renderOne(id);
    }
  } finally {
    globalQueue.instabotPumping = false;
    if (queued().size > 0) void pump();
  }
}

async function renderOne(id: string) {
  const reel = getReel(id);
  if (!reel || reel.status !== "draft") return;
  const nonce = reel.render_nonce;
  patchReel(id, {
    render_status: "rendering",
    render_error: null,
    updated_at: Date.now(),
  });

  const outputPath = path.join(RENDER_DIR, `${id}-${nonce}.mp4`);
  try {
    await renderReelFile({
      photoFile: reel.photo_file,
      line: reel.line,
      motion: reel.motion,
      durationSec: reel.duration_sec,
      outputPath,
    });
    const current = getReel(id);
    if (!current || current.render_nonce !== nonce || current.status !== "draft") {
      fs.rmSync(outputPath, { force: true });
      if (current?.status === "draft") enqueueRender(id);
      return;
    }
    if (current.video_path && current.video_path !== outputPath) {
      fs.rmSync(current.video_path, { force: true });
    }
    patchReel(id, {
      video_path: outputPath,
      render_status: "ready",
      render_error: null,
      rendered_line: current.line,
      rendered_motion: current.motion,
      rendered_at: Date.now(),
      updated_at: Date.now(),
    });
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    const current = getReel(id);
    const message = error instanceof Error ? error.message : "The cut failed.";
    if (!current || current.render_nonce !== nonce) {
      if (current?.status === "draft") enqueueRender(id);
      return;
    }
    patchReel(id, {
      render_status: "error",
      render_error: message.slice(0, 500),
      updated_at: Date.now(),
    });
  }
}

export function markForRender(id: string) {
  const reel = getReel(id);
  if (!reel || reel.status !== "draft") return null;
  const next = patchReel(id, {
    render_nonce: reel.render_nonce + 1,
    render_status: "pending",
    render_error: null,
    updated_at: Date.now(),
  });
  enqueueRender(id);
  return next ?? null;
}

export function fillQueue(extra = 0) {
  const need = Math.max(0, DRAFT_TARGET - countDrafts()) + extra;
  const ids: string[] = [];
  for (let i = 0; i < need; i += 1) ids.push(createDraft());
  for (const id of ids) enqueueRender(id);
  return ids;
}

export function bootQueue() {
  if (globalQueue.instabotBooted) return;
  globalQueue.instabotBooted = true;
  ensureDataDirs();
  purgePublished();
  getDb()
    .prepare(
      "UPDATE reels SET render_status = 'pending' WHERE status = 'draft' AND render_status = 'rendering'",
    )
    .run();
  fillQueue(0);
  const pending = getDb()
    .prepare(
      "SELECT id FROM reels WHERE status = 'draft' AND render_status = 'pending'",
    )
    .all() as { id: string }[];
  for (const row of pending) enqueueRender(row.id);
}
