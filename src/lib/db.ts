import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH, RENDER_DIR, ensureDataDirs } from "@/lib/paths";
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
  created_at: number;
  updated_at: number;
  approved_at: number | null;
  posted_at: number | null;
};

const globalDb = globalThis as unknown as { instabotDb?: Database.Database };

function openDatabase() {
  ensureDataDirs();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  const columns = db.prepare("PRAGMA table_info(reels)").all() as { name: string }[];
  if (columns.length > 0 && !columns.some((column) => column.name === "audio_id")) {
    db.exec("DROP TABLE reels");
    if (fs.existsSync(RENDER_DIR)) {
      for (const file of fs.readdirSync(RENDER_DIR)) {
        if (file.endsWith(".mp4")) fs.rmSync(path.join(RENDER_DIR, file), { force: true });
      }
    }
  }
  db.exec(`
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
  const hadCaptions = db
    .prepare("SELECT 1 AS n FROM sqlite_master WHERE type = 'table' AND name = 'caption_templates'")
    .get();
  db.exec(`
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
  if (!hadCaptions) seedCaptionWords(db);
  migrateVerbBank(db);
  ensureSeedTemplates(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS used_captions (
      caption_key TEXT PRIMARY KEY
    );
  `);
  return db;
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

function seedCaptionWords(db: Database.Database) {
  const word = db.prepare("INSERT INTO caption_words (id, bank, word, position) VALUES (?, ?, ?, ?)");
  const insert = db.transaction(() => {
    SEED_VERBS.forEach((value, index) => word.run(crypto.randomUUID(), "verb", value, index));
    SEED_NOUNS.forEach((value, index) => word.run(crypto.randomUUID(), "noun", value, index));
  });
  insert();
}

function insertMissingWords(db: Database.Database, bank: "noun" | "verb", words: string[]) {
  const insert = db.prepare("INSERT INTO caption_words (id, bank, word, position) VALUES (?, ?, ?, ?)");
  const exists = db.prepare("SELECT 1 AS n FROM caption_words WHERE bank = ? AND word = ?");
  const maxPos = db.prepare("SELECT COALESCE(MAX(position), -1) AS n FROM caption_words WHERE bank = ?");
  const add = db.transaction(() => {
    let position = (maxPos.get(bank) as { n: number }).n;
    for (const word of words) {
      if (exists.get(bank, word)) continue;
      position += 1;
      insert.run(crypto.randomUUID(), bank, word, position);
    }
  });
  add();
}

function migrateVerbBank(db: Database.Database) {
  db.prepare("UPDATE caption_templates SET body = replace(body, '{adjective}', '{verb}')").run();
  const drop = db.prepare("DELETE FROM caption_words WHERE word = ?");
  for (const word of DROPPED_ADJECTIVES) drop.run(word);
  db.prepare("UPDATE caption_words SET bank = 'verb' WHERE bank = 'adjective'").run();
  insertMissingWords(db, "verb", SEED_VERBS);
  insertMissingWords(db, "noun", EXTRA_NOUNS);
}

function ensureSeedTemplates(db: Database.Database) {
  const existing = db.prepare("SELECT id, body FROM caption_templates").all() as { id: string; body: string }[];
  const byBody = new Map(existing.map((row) => [row.body, row]));
  const insert = db.prepare("INSERT INTO caption_templates (id, body, position) VALUES (?, ?, ?)");
  const updatePos = db.prepare("UPDATE caption_templates SET position = ? WHERE id = ?");
  const seedSet = new Set(SEED_TEMPLATES);
  const sync = db.transaction(() => {
    SEED_TEMPLATES.forEach((body, index) => {
      const row = byBody.get(body);
      if (!row) insert.run(crypto.randomUUID(), body, index);
      else updatePos.run(index, row.id);
    });
    let position = SEED_TEMPLATES.length;
    for (const row of existing) {
      if (!seedSet.has(row.body)) updatePos.run(position, row.id);
      position += seedSet.has(row.body) ? 0 : 1;
    }
  });
  sync();
}

export function getDb() {
  if (!globalDb.instabotDb) {
    globalDb.instabotDb = openDatabase();
  }
  return globalDb.instabotDb;
}

export function getReel(id: string) {
  return (
    getDb().prepare("SELECT * FROM reels WHERE id = ?").get(id) as ReelRow | undefined
  );
}

export function listReels() {
  return getDb()
    .prepare(
      "SELECT * FROM reels WHERE status IN ('draft', 'approved') ORDER BY created_at DESC",
    )
    .all() as ReelRow[];
}

export function deleteReel(id: string) {
  const reel = getReel(id);
  if (reel?.video_path) {
    const root = path.resolve(RENDER_DIR);
    const resolved = path.resolve(reel.video_path);
    if ((resolved === root || resolved.startsWith(`${root}${path.sep}`)) && fs.existsSync(resolved)) {
      fs.rmSync(resolved, { force: true });
    }
  }
  getDb().prepare("DELETE FROM reels WHERE id = ?").run(id);
}

export function purgePublished() {
  const rows = getDb().prepare("SELECT id FROM reels WHERE status = 'posted'").all() as { id: string }[];
  for (const row of rows) deleteReel(row.id);
}

export function countApproved() {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM reels WHERE status = 'approved'")
    .get() as { n: number };
  return row.n;
}

export function oldestApproved() {
  return getDb()
    .prepare(
      "SELECT * FROM reels WHERE status = 'approved' ORDER BY approved_at ASC, created_at ASC LIMIT 1",
    )
    .get() as ReelRow | undefined;
}

export function getNextPublishAt() {
  const row = getDb()
    .prepare("SELECT next_publish_at FROM schedule WHERE id = 1")
    .get() as { next_publish_at: number | null } | undefined;
  return row?.next_publish_at ?? null;
}

export function setNextPublishAt(at: number | null) {
  getDb().prepare("UPDATE schedule SET next_publish_at = ? WHERE id = 1").run(at);
}

export function countDrafts() {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM reels WHERE status = 'draft'")
    .get() as { n: number };
  return row.n;
}

export function draftLines() {
  return (
    getDb()
      .prepare("SELECT line FROM reels WHERE status = 'draft'")
      .all() as { line: string }[]
  ).map((row) => row.line);
}

export function usageCounts(column: "photo_id" | "motion") {
  const rows = getDb()
    .prepare(`SELECT ${column} AS key, COUNT(*) AS n FROM reels GROUP BY ${column}`)
    .all() as { key: string; n: number }[];
  return new Map(rows.map((row) => [row.key, row.n]));
}

export function insertReel(row: ReelRow) {
  getDb()
    .prepare(
      `INSERT INTO reels (
        id, status, line, caption, caption_custom,
        photo_id, photo_author, photo_username, photo_source_url, photo_license, photo_license_url, photo_file,
        audio_id, audio_title, audio_artist, audio_artwork_url, audio_preview_url, audio_duration_ms,
        motion, duration_sec, video_path, render_status, render_error, render_nonce,
        rendered_line, rendered_motion, rendered_at,
        post_state, post_error, ig_media_id, created_at, updated_at, approved_at, posted_at
      ) VALUES (
        @id, @status, @line, @caption, @caption_custom,
        @photo_id, @photo_author, @photo_username, @photo_source_url, @photo_license, @photo_license_url, @photo_file,
        @audio_id, @audio_title, @audio_artist, @audio_artwork_url, @audio_preview_url, @audio_duration_ms,
        @motion, @duration_sec, @video_path, @render_status, @render_error, @render_nonce,
        @rendered_line, @rendered_motion, @rendered_at,
        @post_state, @post_error, @ig_media_id, @created_at, @updated_at, @approved_at, @posted_at
      )`,
    )
    .run(row);
}

export function patchReel(id: string, fields: Partial<ReelRow>) {
  const keys = Object.keys(fields) as (keyof ReelRow)[];
  if (keys.length === 0) return getReel(id);
  const assignments = keys.map((key) => `${key} = @${key}`).join(", ");
  getDb()
    .prepare(`UPDATE reels SET ${assignments} WHERE id = @id`)
    .run({ ...fields, id });
  return getReel(id);
}

export function videoExists(row: ReelRow) {
  return Boolean(row.video_path && fs.existsSync(row.video_path));
}
