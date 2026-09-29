import winkPosTagger from "wink-pos-tagger";
import { getDb } from "@/lib/db";

const tagger = winkPosTagger();

export type CaptionBank = "noun" | "adjective";

export type CaptionEntry = {
  id: string;
  text: string;
};

export type CaptionDesk = {
  templates: CaptionEntry[];
  nouns: CaptionEntry[];
  adjectives: CaptionEntry[];
};

export class CaptionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const TOKEN = /\{(noun|adjective|him\/her|he\/she|his\/her)\}/g;
const BLANK = /\{(noun|adjective)\}/g;
const PIECE = /\{(?:noun|adjective|him\/her|he\/she|his\/her)\}|[A-Za-z]+(?:'[A-Za-z]+)?|\s+|./g;
const WORD = /^[A-Za-z]+(?:'[A-Za-z]+)?$/;
const MAX_TEMPLATE = 220;
const MAX_WORD = 48;

const CLOSED = new Set(
  `a an the
i me my mine myself
you your yours yourself yourselves
we us our ours ourselves
they them their theirs themselves
it its itself
this that these those
am is are was were be been being
do does did doing done
have has had having
will would shall should can could may might must
of to in on at for with from by as into over after before about between through during without within
and or but nor so yet if than then because while
not no
dont don't im i'm ive i've id i'd youre you're theyre they're thats that's whats what's cant can't wont won't aint ain't
when where who whom whose which what how why
just`
    .split(/\s+/)
    .filter(Boolean),
);

function clean(value: unknown, max: number, label: string) {
  if (typeof value !== "string") throw new CaptionError(`${label} needs words.`);
  const text = value.trim();
  if (!text) throw new CaptionError(`${label} can't be empty.`);
  if (text.length > max) throw new CaptionError(`${label} is too long.`);
  return text;
}

export function captionDesk(): CaptionDesk {
  const db = getDb();
  const templates = db
    .prepare("SELECT id, body AS text FROM caption_templates ORDER BY position ASC, rowid ASC")
    .all() as CaptionEntry[];
  const words = db
    .prepare("SELECT id, bank, word AS text FROM caption_words ORDER BY position ASC, rowid ASC")
    .all() as { id: string; bank: string; text: string }[];
  return {
    templates,
    nouns: words.filter((word) => word.bank === "noun").map(({ id, text }) => ({ id, text })),
    adjectives: words.filter((word) => word.bank === "adjective").map(({ id, text }) => ({ id, text })),
  };
}

export function addTemplate(value: unknown) {
  const text = clean(value, MAX_TEMPLATE, "A template");
  const db = getDb();
  const row = db.prepare("SELECT COALESCE(MAX(position), -1) AS n FROM caption_templates").get() as { n: number };
  db.prepare("INSERT INTO caption_templates (id, body, position) VALUES (?, ?, ?)").run(
    crypto.randomUUID(),
    text,
    row.n + 1,
  );
  return captionDesk();
}

export function deleteTemplate(id: unknown) {
  if (typeof id !== "string" || !id) throw new CaptionError("That template is missing.");
  const result = getDb().prepare("DELETE FROM caption_templates WHERE id = ?").run(id);
  if (result.changes === 0) throw new CaptionError("That template is already gone.", 404);
  return captionDesk();
}

export function addWord(bank: unknown, value: unknown) {
  if (bank !== "noun" && bank !== "adjective") throw new CaptionError("Pick the noun or adjective bank.");
  const text = clean(value, MAX_WORD, "A word");
  const db = getDb();
  const existing = db
    .prepare("SELECT 1 AS n FROM caption_words WHERE bank = ? AND word = ?")
    .get(bank, text) as { n: number } | undefined;
  if (existing) throw new CaptionError("That word is already in the bank.");
  const row = db
    .prepare("SELECT COALESCE(MAX(position), -1) AS n FROM caption_words WHERE bank = ?")
    .get(bank) as { n: number };
  db.prepare("INSERT INTO caption_words (id, bank, word, position) VALUES (?, ?, ?, ?)").run(
    crypto.randomUUID(),
    bank,
    text,
    row.n + 1,
  );
  return captionDesk();
}

export function deleteWord(id: unknown) {
  if (typeof id !== "string" || !id) throw new CaptionError("That word is missing.");
  const result = getDb().prepare("DELETE FROM caption_words WHERE id = ?").run(id);
  if (result.changes === 0) throw new CaptionError("That word is already gone.", 404);
  return captionDesk();
}

export function flipBlank(id: unknown, index: unknown) {
  if (typeof id !== "string" || !id) throw new CaptionError("That template is missing.");
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    throw new CaptionError("That blank is missing.");
  }
  const db = getDb();
  const row = db.prepare("SELECT body FROM caption_templates WHERE id = ?").get(id) as { body: string } | undefined;
  if (!row) throw new CaptionError("That template is already gone.", 404);
  let seen = 0;
  let flipped = false;
  const body = row.body.replace(BLANK, (token) => {
    if (seen !== index) {
      seen += 1;
      return token;
    }
    seen += 1;
    flipped = true;
    return token === "{noun}" ? "{adjective}" : "{noun}";
  });
  if (!flipped) throw new CaptionError("That blank is missing.");
  db.prepare("UPDATE caption_templates SET body = ? WHERE id = ?").run(body, id);
  return captionDesk();
}

export function flipWord(id: unknown) {
  if (typeof id !== "string" || !id) throw new CaptionError("That word is missing.");
  const db = getDb();
  const row = db.prepare("SELECT id, bank, word FROM caption_words WHERE id = ?").get(id) as
    | { id: string; bank: CaptionBank; word: string }
    | undefined;
  if (!row) throw new CaptionError("That word is already gone.", 404);
  const nextBank: CaptionBank = row.bank === "noun" ? "adjective" : "noun";
  const duplicate = db
    .prepare("SELECT id FROM caption_words WHERE bank = ? AND word = ?")
    .get(nextBank, row.word) as { id: string } | undefined;
  if (duplicate) {
    db.prepare("DELETE FROM caption_words WHERE id = ?").run(row.id);
  } else {
    const position = db
      .prepare("SELECT COALESCE(MAX(position), -1) AS n FROM caption_words WHERE bank = ?")
      .get(nextBank) as { n: number };
    db.prepare("UPDATE caption_words SET bank = ?, position = ? WHERE id = ?").run(nextBank, position.n + 1, row.id);
  }
  return captionDesk();
}

function rememberWord(bank: CaptionBank, word: string, seen: Set<string>) {
  const text = word.toLowerCase();
  if (!text || text.length > MAX_WORD || seen.has(text)) return;
  seen.add(text);
  const db = getDb();
  const existing = db
    .prepare("SELECT 1 AS n FROM caption_words WHERE bank = ? AND word = ?")
    .get(bank, text) as { n: number } | undefined;
  if (existing) return;
  const row = db
    .prepare("SELECT COALESCE(MAX(position), -1) AS n FROM caption_words WHERE bank = ?")
    .get(bank) as { n: number };
  db.prepare("INSERT INTO caption_words (id, bank, word, position) VALUES (?, ?, ?, ?)").run(
    crypto.randomUUID(),
    bank,
    text,
    row.n + 1,
  );
}

function rememberTemplate(body: string) {
  const text = body.trim();
  if (!text || text.length > MAX_TEMPLATE) return;
  const db = getDb();
  const existing = db.prepare("SELECT 1 AS n FROM caption_templates WHERE body = ?").get(text) as
    | { n: number }
    | undefined;
  if (existing) return;
  const row = db.prepare("SELECT COALESCE(MAX(position), -1) AS n FROM caption_templates").get() as { n: number };
  db.prepare("INSERT INTO caption_templates (id, body, position) VALUES (?, ?, ?)").run(
    crypto.randomUUID(),
    text,
    row.n + 1,
  );
}

function posesForWords(words: string[]) {
  if (words.length === 0) return [];
  const tagged = tagger.tagSentence(words.join(" "));
  const poses: string[] = [];
  let index = 0;
  for (const word of words) {
    const target = word.toLowerCase();
    let acc = "";
    let pos = "";
    while (index < tagged.length && acc !== target) {
      const token = tagged[index];
      index += 1;
      if (token.tag === "punctuation" && !target.includes(token.value.toLowerCase())) {
        if (acc === "") continue;
        break;
      }
      acc += token.value.toLowerCase();
      if (token.tag === "word") pos = token.pos;
      if (acc === target) break;
    }
    poses.push(pos);
  }
  return poses;
}

export function captionKey(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function blockedCaptionKeys() {
  const keys = new Set<string>();
  const remembered = getDb().prepare("SELECT caption_key FROM used_captions").all() as { caption_key: string }[];
  for (const row of remembered) keys.add(row.caption_key);
  const live = getDb().prepare(
    "SELECT caption FROM reels WHERE status IN ('draft', 'approved')",
  ).all() as { caption: string }[];
  for (const row of live) {
    const key = captionKey(row.caption);
    if (key) keys.add(key);
  }
  return keys;
}

export function rememberCaption(caption: string) {
  const key = captionKey(caption);
  if (!key) return;
  getDb().prepare("INSERT OR IGNORE INTO used_captions (caption_key) VALUES (?)").run(key);
}

export function captionUsedOnCard(id: string, status: string, caption: string) {
  const key = captionKey(caption);
  if (!key) return false;
  const others = getDb().prepare(
    "SELECT caption FROM reels WHERE status IN ('draft', 'approved') AND id != ?",
  ).all(id) as { caption: string }[];
  if (others.some((row) => captionKey(row.caption) === key)) return true;
  if (status !== "draft") return false;
  const remembered = getDb()
    .prepare("SELECT 1 AS n FROM used_captions WHERE caption_key = ?")
    .get(key) as { n: number } | undefined;
  return Boolean(remembered);
}

function slotForWord(word: string, pos: string, nouns: Set<string>, adjectives: Set<string>) {
  const lower = word.toLowerCase();
  if (lower === "he" || lower === "she") return "{he/she}";
  if (lower === "him" || lower === "her") return "{him/her}";
  if (lower === "his") return "{his/her}";
  if (CLOSED.has(lower)) return word;
  if (adjectives.has(lower)) return "{adjective}";
  if (nouns.has(lower)) return "{noun}";
  if (pos.startsWith("JJ")) {
    rememberWord("adjective", lower, adjectives);
    return "{adjective}";
  }
  if (pos.startsWith("NN")) {
    rememberWord("noun", lower, nouns);
    return "{noun}";
  }
  return word;
}

export function learnLine(line: string) {
  const pieces = line.match(PIECE) ?? [line];
  const words = pieces.filter((piece) => WORD.test(piece));
  const poses = posesForWords(words);
  const desk = captionDesk();
  const nouns = new Set(desk.nouns.map((entry) => entry.text.toLowerCase()));
  const adjectives = new Set(desk.adjectives.map((entry) => entry.text.toLowerCase()));
  let wordIndex = 0;
  const body = pieces
    .map((piece) => {
      if (piece.startsWith("{") && piece.endsWith("}")) return piece;
      if (!WORD.test(piece)) return piece;
      const pos = poses[wordIndex] ?? "";
      wordIndex += 1;
      return slotForWord(piece, pos, nouns, adjectives);
    })
    .join("");
  rememberTemplate(body);
}

function tokenChoices(token: string, nouns: string[], adjectives: string[]) {
  if (token === "{noun}") return nouns.length ? nouns : null;
  if (token === "{adjective}") return adjectives.length ? adjectives : null;
  if (token === "{he/she}") return ["he", "she"];
  if (token === "{him/her}") return ["him", "her"];
  if (token === "{his/her}") return ["his", "her"];
  return null;
}

function* fillsOf(template: string, nouns: string[], adjectives: string[]) {
  const tokens = template.match(new RegExp(TOKEN.source, "g")) ?? [];
  if (tokens.length === 0) {
    yield template;
    return;
  }
  const options = tokens.map((token) => tokenChoices(token, nouns, adjectives));
  if (options.some((option) => !option)) return;
  const lists = options as string[][];
  const total = lists.reduce((count, list) => count * list.length, 1);
  const cap = 4096;
  const count = Math.min(total, cap);
  const start = total > cap ? Math.floor(Math.random() * total) : 0;
  for (let step = 0; step < count; step += 1) {
    let n = (start + step) % total;
    const picks: string[] = [];
    for (const list of lists) {
      picks.push(list[n % list.length] ?? "");
      n = Math.floor(n / list.length);
    }
    let index = 0;
    yield template.replace(new RegExp(TOKEN.source, "g"), () => picks[index++] ?? "");
  }
}

export function nextLine(exclude: string[] = []) {
  const desk = captionDesk();
  if (desk.templates.length === 0) {
    throw new CaptionError("Add a caption template before generating a line.");
  }
  const nouns = desk.nouns.map((entry) => entry.text);
  const adjectives = desk.adjectives.map((entry) => entry.text);
  const blocked = blockedCaptionKeys();
  for (const extra of exclude) {
    const key = captionKey(extra);
    if (key) blocked.add(key);
  }
  const templates = [...desk.templates];
  for (let index = templates.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = templates[index];
    templates[index] = templates[swap] ?? current;
    templates[swap] = current;
  }
  let produced = false;
  for (const template of templates) {
    for (const line of fillsOf(template.text, nouns, adjectives)) {
      produced = true;
      if (!blocked.has(captionKey(line))) return line;
    }
  }
  if (!produced) {
    const needsNoun = desk.templates.some((entry) => entry.text.includes("{noun}"));
    const needsAdjective = desk.templates.some((entry) => entry.text.includes("{adjective}"));
    if (needsNoun && nouns.length === 0) throw new CaptionError("Add a noun. A template uses {noun}.");
    if (needsAdjective && adjectives.length === 0) {
      throw new CaptionError("Add an adjective. A template uses {adjective}.");
    }
    throw new CaptionError("Those templates could not be filled.");
  }
  throw new CaptionError("Every caption from these templates has already been used.");
}
