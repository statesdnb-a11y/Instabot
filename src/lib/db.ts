import fs from "node:fs";
import path from "node:path";
import { removeStoredVideo } from "@/lib/media";
import { RENDER_DIR } from "@/lib/paths";
import { openSql, tursoEnabled, type Sql } from "@/lib/sql";
import { BED_TRACKS } from "@/lib/tracks";
import type { Motion, PostState, ReelStatus, RenderStatus } from "@/lib/types";

export type ReelRow = {
  id: string;
  status: ReelStatus;
  line: string;
  caption: string;
  caption_custom: number;
  photo_id: string;
  photo_author: string;
  photo_username: string;
  photo_source_url: string;
  photo_license: string;
  photo_license_url: string;
  photo_file: string;
  still_url: string | null;
  audio_id: string | null;
  audio_title: string | null;
  audio_artist: string | null;
  audio_artwork_url: string | null;
  audio_preview_url: string | null;
  audio_duration_ms: number | null;
  motion: Motion;
  duration_sec: number;
  video_path: string | null;
  render_status: RenderStatus;
  render_error: string | null;
  render_nonce: number;
  rendered_line: string | null;
  rendered_motion: Motion | null;
  rendered_at: number | null;
  post_state: PostState;
  post_error: string | null;
  ig_media_id: string | null;
  bed_track: string | null;
  created_at: number;
  updated_at: number;
  approved_at: number | null;
  posted_at: number | null;
};

const globalDb = globalThis as unknown as { instabotSql?: Promise<Sql> };

async function openDatabase() {
  const db = openSql();
  const columns = await db.all<{ name: string }>("PRAGMA table_info(reels)");
  if (columns.length > 0 && !columns.some((column) => column.name === "audio_id")) {
    await db.exec("DROP TABLE reels");
    if (!tursoEnabled() && fs.existsSync(RENDER_DIR)) {
      for (const file of fs.readdirSync(RENDER_DIR)) {
        if (file.endsWith(".mp4")) fs.rmSync(path.join(RENDER_DIR, file), { force: true });
      }
    }
  }
  await db.exec(`
    CREATE TABLE IF NOT EXISTS reels (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      line TEXT NOT NULL,
      caption TEXT NOT NULL,
      caption_custom INTEGER NOT NULL DEFAULT 0,
      photo_id TEXT NOT NULL,
      photo_author TEXT NOT NULL,
      photo_username TEXT NOT NULL,
      photo_source_url TEXT NOT NULL,
      photo_license TEXT NOT NULL,
      photo_license_url TEXT NOT NULL,
      photo_file TEXT NOT NULL,
      still_url TEXT,
      audio_id TEXT,
      audio_title TEXT,
      audio_artist TEXT,
      audio_artwork_url TEXT,
      audio_preview_url TEXT,
      audio_duration_ms INTEGER,
      motion TEXT NOT NULL,
      duration_sec INTEGER NOT NULL,
      video_path TEXT,
      render_status TEXT NOT NULL,
      render_error TEXT,
      render_nonce INTEGER NOT NULL,
      rendered_line TEXT,
      rendered_motion TEXT,
      rendered_at INTEGER,
      post_state TEXT,
      post_error TEXT,
      ig_media_id TEXT,
      bed_track TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      approved_at INTEGER,
      posted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS reels_status ON reels(status);
    CREATE TABLE IF NOT EXISTS schedule (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_publish_at INTEGER
    );
    INSERT OR IGNORE INTO schedule (id, next_publish_at) VALUES (1, NULL);
  `);
  const reelColumns = await db.all<{ name: string }>("PRAGMA table_info(reels)");
  if (reelColumns.length > 0 && !reelColumns.some((column) => column.name === "bed_track")) {
    await db.exec("ALTER TABLE reels ADD COLUMN bed_track TEXT");
  }
  if (reelColumns.length > 0 && !reelColumns.some((column) => column.name === "still_url")) {
    await db.exec("ALTER TABLE reels ADD COLUMN still_url TEXT");
  }
  const hadCaptions = await db.get(
    "SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = 'caption_templates'",
  );
  await db.exec(`
    CREATE TABLE IF NOT EXISTS caption_templates (
      id TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      position INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS caption_words (
      id TEXT PRIMARY KEY,
      bank TEXT NOT NULL,
      word TEXT NOT NULL,
      position INTEGER NOT NULL
    );
  `);
  if (!hadCaptions) await seedCaptionWords(db);
  await migrateVerbBank(db);
  await ensureSeedTemplates(db);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS used_captions (
      caption_key TEXT PRIMARY KEY
    );
    CREATE TABLE IF NOT EXISTS skipped_captions (
      caption_key TEXT PRIMARY KEY,
      skipped_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS caption_cooldowns (
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      remaining INTEGER NOT NULL,
      PRIMARY KEY (kind, value)
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS used_bed_tracks (
      track_id TEXT PRIMARY KEY,
      used_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shown_stills (
      photo_id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      shown_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS instagram_connection (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_token TEXT NOT NULL,
      ig_user_id TEXT NOT NULL,
      username TEXT,
      connected_at INTEGER NOT NULL
    );
  `);
  await rememberReelsAsShown(db);
  await forgetApprovedHistory(db);
  return db;
}

async function rememberReelsAsShown(db: Sql) {
  const rows = await db.all<{ photo_id: string; photo_username: string; created_at: number }>(
    "SELECT photo_id, photo_username, created_at FROM reels",
  );
  for (const row of rows) {
    if (!/^\d+$/.test(row.photo_id) || !row.photo_username?.trim()) continue;
    await db.run(
      "INSERT OR IGNORE INTO shown_stills (photo_id, username, shown_at) VALUES (?, ?, ?)",
      row.photo_id,
      row.photo_username.trim(),
      row.created_at,
    );
  }
}

/** One-shot on the next open so a Vercel deploy clears live Turso without a token here. */
async function forgetApprovedHistory(db: Sql) {
  const done = await db.get<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", "forget_used_lines_v1");
  if (done) return;
  const before = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM used_captions");
  const approved = await db.all<{ id: string; video_path: string | null }>(
    "SELECT id, video_path FROM reels WHERE status = 'approved'",
  );
  await db.run("DELETE FROM used_captions");
  for (const row of approved) {
    await removeStoredVideo(row.video_path).catch(() => undefined);
    await db.run("DELETE FROM reels WHERE id = ?", row.id);
  }
  const after = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM used_captions");
  const note = JSON.stringify({
    usedBefore: before?.n ?? 0,
    usedAfter: after?.n ?? 0,
    approvedRemoved: approved.length,
  });
  await db.run("INSERT INTO app_meta (key, value) VALUES (?, ?)", "forget_used_lines_v1", note);
}

const SEED_TEMPLATES = [
  "me when I melt {him/her}",
  "thinking of chewing {him/her}",
  "this bitch got me steady {verb}",
  "i need to itch my asshole",
  "{he/she} dont know im {verb}",
  "got my hands up {his/her} {noun}",
  "i wonder if {he/she} {verb}",
  "i been using your shampoo",
  "i been drinking your fancy soap",
  "im {verb} your panties",
  "you make me hungry",
];

const SEED_VERBS = [
  "chewing",
  "melting",
  "itching",
  "drinking",
  "using",
  "smelling",
  "licking",
  "stealing",
  "wearing",
  "eating",
];

const EXTRA_VERBS = [
  "wanking",
  "threatening",
  "stabbing",
  "loving",
  "kissing",
  "spanking",
  "hugging",
  "spooning",
  "licking",
  "mclovin",
  "blazing",
  "chewing",
  "eating",
  "chowing",
  "slapping",
];

const EXTRA_NOUNS = [
  "gooch",
  "dog",
  "teacher",
  "asshole",
  "genital",
  "peepee",
  "donger",
  "beef",
  "meat",
  "sausage",
  "ham",
  "cheese",
];

const DROPPED_ADJECTIVES = [
  "nasty",
  "feral",
  "sick",
  "gone",
  "stupid",
  "pressed",
  "unhinged",
  "down bad",
  "steady",
];

const SEED_NOUNS = ["problem", "threat", "meal", "habit", "crashout", "situation"];

async function seedCaptionWords(db: Sql) {
  for (const [index, value] of SEED_VERBS.entries()) {
    await db.run("INSERT INTO caption_words (id, bank, word, position) VALUES (?, ?, ?, ?)", crypto.randomUUID(), "verb", value, index);
  }
  for (const [index, value] of SEED_NOUNS.entries()) {
    await db.run("INSERT INTO caption_words (id, bank, word, position) VALUES (?, ?, ?, ?)", crypto.randomUUID(), "noun", value, index);
  }
}

async function insertMissingWords(db: Sql, bank: "noun" | "verb", words: string[]) {
  const maxPos = await db.get<{ n: number }>("SELECT COALESCE(MAX(position), -1) AS n FROM caption_words WHERE bank = ?", bank);
  let position = maxPos?.n ?? -1;
  for (const word of words) {
    const existing = await db.get("SELECT 1 AS n FROM caption_words WHERE bank = ? AND word = ?", bank, word);
    if (existing) continue;
    position += 1;
    await db.run(
      "INSERT INTO caption_words (id, bank, word, position) VALUES (?, ?, ?, ?)",
      crypto.randomUUID(),
      bank,
      word,
      position,
    );
  }
}

async function migrateVerbBank(db: Sql) {
  await db.run("UPDATE caption_templates SET body = replace(body, '{adjective}', '{verb}')");
  for (const word of DROPPED_ADJECTIVES) {
    await db.run("DELETE FROM caption_words WHERE word = ?", word);
  }
  await db.run("UPDATE caption_words SET bank = 'verb' WHERE bank = 'adjective'");
  await insertMissingWords(db, "verb", SEED_VERBS);
  await insertMissingWords(db, "verb", EXTRA_VERBS);
  await insertMissingWords(db, "noun", EXTRA_NOUNS);
}

async function ensureSeedTemplates(db: Sql) {
  const existing = await db.all<{ id: string; body: string }>("SELECT id, body FROM caption_templates");
  const byBody = new Map(existing.map((row) => [row.body, row]));
  const seedSet = new Set(SEED_TEMPLATES);
  for (const [index, body] of SEED_TEMPLATES.entries()) {
    const row = byBody.get(body);
    if (!row) {
      await db.run("INSERT INTO caption_templates (id, body, position) VALUES (?, ?, ?)", crypto.randomUUID(), body, index);
    } else {
      await db.run("UPDATE caption_templates SET position = ? WHERE id = ?", index, row.id);
    }
  }
  let position = SEED_TEMPLATES.length;
  for (const row of existing) {
    if (!seedSet.has(row.body)) {
      await db.run("UPDATE caption_templates SET position = ? WHERE id = ?", position, row.id);
      position += 1;
    }
  }
}

export function getSql() {
  if (!globalDb.instabotSql) {
    globalDb.instabotSql = openDatabase().catch((error: unknown) => {
      globalDb.instabotSql = undefined;
      throw error;
    });
  }
  return globalDb.instabotSql;
}

export async function getReel(id: string) {
  const db = await getSql();
  return db.get<ReelRow>("SELECT * FROM reels WHERE id = ?", id);
}

export async function listReels() {
  const db = await getSql();
  return db.all<ReelRow>("SELECT * FROM reels WHERE status IN ('draft', 'approved') ORDER BY created_at DESC");
}

export async function deleteReel(id: string) {
  const reel = await getReel(id);
  if (reel?.video_path) await removeStoredVideo(reel.video_path);
  const db = await getSql();
  await db.run("DELETE FROM reels WHERE id = ?", id);
}

export async function purgePublished() {
  const db = await getSql();
  const rows = await db.all<{ id: string }>("SELECT id FROM reels WHERE status = 'posted'");
  for (const row of rows) await deleteReel(row.id);
}

export async function countApproved() {
  const db = await getSql();
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM reels WHERE status = 'approved'");
  return row?.n ?? 0;
}

export async function countDrafts() {
  const db = await getSql();
  const row = await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM reels WHERE status = 'draft'");
  return row?.n ?? 0;
}

export async function draftLines() {
  const db = await getSql();
  const rows = await db.all<{ line: string }>("SELECT line FROM reels WHERE status = 'draft'");
  return rows.map((row) => row.line);
}

export async function usageCounts(column: "photo_id" | "motion") {
  const db = await getSql();
  const rows = await db.all<{ key: string; n: number }>(
    `SELECT ${column} AS key, COUNT(*) AS n FROM reels GROUP BY ${column}`,
  );
  return new Map(rows.map((row) => [row.key, row.n]));
}

export async function insertReel(row: ReelRow) {
  const db = await getSql();
  await db.run(
    `INSERT INTO reels (
      id, status, line, caption, caption_custom,
      photo_id, photo_author, photo_username, photo_source_url, photo_license, photo_license_url, photo_file, still_url,
      audio_id, audio_title, audio_artist, audio_artwork_url, audio_preview_url, audio_duration_ms,
      motion, duration_sec, video_path, render_status, render_error, render_nonce,
      rendered_line, rendered_motion, rendered_at,
      post_state, post_error, ig_media_id, bed_track, created_at, updated_at, approved_at, posted_at
    ) VALUES (
      @id, @status, @line, @caption, @caption_custom,
      @photo_id, @photo_author, @photo_username, @photo_source_url, @photo_license, @photo_license_url, @photo_file, @still_url,
      @audio_id, @audio_title, @audio_artist, @audio_artwork_url, @audio_preview_url, @audio_duration_ms,
      @motion, @duration_sec, @video_path, @render_status, @render_error, @render_nonce,
      @rendered_line, @rendered_motion, @rendered_at,
      @post_state, @post_error, @ig_media_id, @bed_track, @created_at, @updated_at, @approved_at, @posted_at
    )`,
    row,
  );
}

export type InstagramConnection = {
  access_token: string;
  ig_user_id: string;
  username: string | null;
  connected_at: number;
};

export async function getInstagramConnection() {
  const db = await getSql();
  return db.get<InstagramConnection>(
    "SELECT access_token, ig_user_id, username, connected_at FROM instagram_connection WHERE id = 1",
  );
}

export async function saveInstagramConnection(input: {
  accessToken: string;
  igUserId: string;
  username: string | null;
}) {
  const db = await getSql();
  await db.run(
    `INSERT INTO instagram_connection (id, access_token, ig_user_id, username, connected_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       access_token = excluded.access_token,
       ig_user_id = excluded.ig_user_id,
       username = excluded.username,
       connected_at = excluded.connected_at`,
    input.accessToken,
    input.igUserId,
    input.username,
    Date.now(),
  );
}

export async function clearInstagramConnection() {
  const db = await getSql();
  await db.run("DELETE FROM instagram_connection WHERE id = 1");
}

export async function loadShownStills() {
  const db = await getSql();
  const rows = await db.all<{ photo_id: string; username: string }>("SELECT photo_id, username FROM shown_stills");
  const ids = new Set<string>();
  const usernames = new Set<string>();
  for (const row of rows) {
    if (row.photo_id) ids.add(row.photo_id);
    const username = row.username?.trim().toLowerCase();
    if (username) usernames.add(username);
  }
  return { ids, usernames };
}

export async function rememberShownStill(photoId: string, username: string) {
  if (!/^\d+$/.test(photoId)) return;
  const name = username.trim();
  if (!name) return;
  const db = await getSql();
  await db.run(
    `INSERT INTO shown_stills (photo_id, username, shown_at) VALUES (?, ?, ?)
     ON CONFLICT(photo_id) DO UPDATE SET username = excluded.username, shown_at = excluded.shown_at`,
    photoId,
    name,
    Date.now(),
  );
}

export type BedTrackTake = { id: string; cleared: string[] };

async function usedBedIds(db: Sql) {
  const rows = await db.all<{ track_id: string }>("SELECT track_id FROM used_bed_tracks");
  return rows.map((row) => row.track_id);
}

function nextUnusedBed(used: Set<string>, avoid: string | null) {
  const start = avoid ? BED_TRACKS.findIndex((track) => track.id === avoid) : -1;
  for (let step = 1; step <= BED_TRACKS.length; step += 1) {
    const track = BED_TRACKS[(start + step) % BED_TRACKS.length];
    if (!track || used.has(track.id) || track.id === avoid) continue;
    return track;
  }
  return null;
}

export async function peekNextBedTrack() {
  const db = await getSql();
  const used = new Set(await usedBedIds(db));
  const next = nextUnusedBed(used, null) ?? BED_TRACKS[0];
  return { id: next.id, label: next.label };
}

export async function takeNextBedTrack(avoid?: string | null): Promise<BedTrackTake> {
  const db = await getSql();
  const existing = await usedBedIds(db);
  const used = new Set(existing);
  let cleared: string[] = [];
  let next = nextUnusedBed(used, avoid ?? null);
  if (!next) {
    cleared = existing;
    await db.run("DELETE FROM used_bed_tracks");
    next = nextUnusedBed(new Set(), avoid ?? null) ?? BED_TRACKS[0];
  }
  await db.run(
    `INSERT INTO used_bed_tracks (track_id, used_at) VALUES (?, ?)
     ON CONFLICT(track_id) DO UPDATE SET used_at = excluded.used_at`,
    next.id,
    Date.now(),
  );
  return { id: next.id, cleared };
}

export async function noteChosenBedTrack(trackId: string) {
  if (!BED_TRACKS.some((track) => track.id === trackId)) return;
  const db = await getSql();
  await db.run(
    `INSERT INTO used_bed_tracks (track_id, used_at) VALUES (?, ?)
     ON CONFLICT(track_id) DO UPDATE SET used_at = excluded.used_at`,
    trackId,
    Date.now(),
  );
}

export async function undoBedTrackTake(take: BedTrackTake) {
  const db = await getSql();
  await db.run("DELETE FROM used_bed_tracks WHERE track_id = ?", take.id);
  for (const id of take.cleared) {
    await db.run("INSERT OR IGNORE INTO used_bed_tracks (track_id, used_at) VALUES (?, ?)", id, Date.now());
  }
}

export async function claimBedTrack(id: string, trackId: string) {
  const db = await getSql();
  const result = await db.run(
    "UPDATE reels SET bed_track = ?, updated_at = ? WHERE id = ? AND bed_track IS NULL",
    trackId,
    Date.now(),
    id,
  );
  return result.changes === 1;
}

export async function patchReel(id: string, fields: Partial<ReelRow>) {
  const keys = Object.keys(fields) as (keyof ReelRow)[];
  if (keys.length === 0) return getReel(id);
  const assignments = keys.map((key) => `${key} = @${key}`).join(", ");
  const db = await getSql();
  await db.run(`UPDATE reels SET ${assignments} WHERE id = @id`, { ...fields, id });
  return getReel(id);
}
