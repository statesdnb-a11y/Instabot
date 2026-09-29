import winkPosTagger from "wink-pos-tagger";
import { getSql } from "@/lib/db";

const tagger = winkPosTagger();

export type CaptionBank = "noun" | "verb";

export type CaptionEntry = {
  id: string;
  text: string;
};

export type CaptionDesk = {
  templates: CaptionEntry[];
  nouns: CaptionEntry[];
  verbs: CaptionEntry[];
};

export class CaptionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const TOKEN = /\{(noun|verb|him\/her|he\/she|his\/her)\}/g;
const BLANK = /\{(noun|verb)\}/g;
const PIECE = /\{(?:noun|verb|him\/her|he\/she|his\/her)\}|[A-Za-z]+(?:'[A-Za-z]+)?|\s+|./g;
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

export async function captionDesk(): Promise<CaptionDesk> {
  const db = await getSql();
  const templates = await db.all<CaptionEntry>(
    "SELECT id, body AS text FROM caption_templates ORDER BY position ASC, rowid ASC",
  );
  const words = await db.all<{ id: string; bank: string; text: string }>(
    "SELECT id, bank, word AS text FROM caption_words ORDER BY position ASC, rowid ASC",
  );
  return {
    templates,
    nouns: words.filter((word) => word.bank === "noun").map(({ id, text }) => ({ id, text })),
    verbs: words.filter((word) => word.bank === "verb").map(({ id, text }) => ({ id, text })),
  };
}

export async function addTemplate(value: unknown) {
  const text = clean(value, MAX_TEMPLATE, "A template");
  const db = await getSql();
  const row = await db.get<{ n: number }>("SELECT COALESCE(MAX(position), -1) AS n FROM caption_templates");
  await db.run("INSERT INTO caption_templates (id, body, position) VALUES (?, ?, ?)", crypto.randomUUID(), text, (row?.n ?? -1) + 1);
  return captionDesk();
}

export async function deleteTemplate(id: unknown) {
  if (typeof id !== "string" || !id) throw new CaptionError("That template is missing.");
  const db = await getSql();
  const result = await db.run("DELETE FROM caption_templates WHERE id = ?", id);
  if (result.changes === 0) throw new CaptionError("That template is already gone.", 404);
  return captionDesk();
}

export async function addWord(bank: unknown, value: unknown) {
  if (bank !== "noun" && bank !== "verb") throw new CaptionError("Pick the noun or verb bank.");
  const text = clean(value, MAX_WORD, "A word");
  const db = await getSql();
  const existing = await db.get("SELECT 1 AS n FROM caption_words WHERE bank = ? AND word = ?", bank, text);
  if (existing) throw new CaptionError("That word is already in the bank.");
  const row = await db.get<{ n: number }>("SELECT COALESCE(MAX(position), -1) AS n FROM caption_words WHERE bank = ?", bank);
  await db.run(
    "INSERT INTO caption_words (id, bank, word, position) VALUES (?, ?, ?, ?)",
    crypto.randomUUID(),
    bank,
    text,
    (row?.n ?? -1) + 1,
  );
  return captionDesk();
}

export async function deleteWord(id: unknown) {
  if (typeof id !== "string" || !id) throw new CaptionError("That word is missing.");
  const db = await getSql();
  const result = await db.run("DELETE FROM caption_words WHERE id = ?", id);
  if (result.changes === 0) throw new CaptionError("That word is already gone.", 404);
  return captionDesk();
}

export async function flipBlank(id: unknown, index: unknown) {
  if (typeof id !== "string" || !id) throw new CaptionError("That template is missing.");
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    throw new CaptionError("That blank is missing.");
  }
  const db = await getSql();
  const row = await db.get<{ body: string }>("SELECT body FROM caption_templates WHERE id = ?", id);
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
    return token === "{noun}" ? "{verb}" : "{noun}";
  });
  if (!flipped) throw new CaptionError("That blank is missing.");
  await db.run("UPDATE caption_templates SET body = ? WHERE id = ?", body, id);
  return captionDesk();
}

export async function flipWord(id: unknown) {
  if (typeof id !== "string" || !id) throw new CaptionError("That word is missing.");
  const db = await getSql();
  const row = await db.get<{ id: string; bank: CaptionBank; word: string }>(
    "SELECT id, bank, word FROM caption_words WHERE id = ?",
    id,
  );
  if (!row) throw new CaptionError("That word is already gone.", 404);
  const nextBank: CaptionBank = row.bank === "noun" ? "verb" : "noun";
  const duplicate = await db.get<{ id: string }>("SELECT id FROM caption_words WHERE bank = ? AND word = ?", nextBank, row.word);
  if (duplicate) {
    await db.run("DELETE FROM caption_words WHERE id = ?", row.id);
  } else {
    const position = await db.get<{ n: number }>(
      "SELECT COALESCE(MAX(position), -1) AS n FROM caption_words WHERE bank = ?",
      nextBank,
    );
    await db.run("UPDATE caption_words SET bank = ?, position = ? WHERE id = ?", nextBank, (position?.n ?? -1) + 1, row.id);
  }
  return captionDesk();
}

async function rememberWord(bank: CaptionBank, word: string, seen: Set<string>) {
  const text = word.toLowerCase();
  if (!text || text.length > MAX_WORD || seen.has(text)) return;
  seen.add(text);
  const db = await getSql();
  const existing = await db.get("SELECT 1 AS n FROM caption_words WHERE bank = ? AND word = ?", bank, text);
  if (existing) return;
  const row = await db.get<{ n: number }>("SELECT COALESCE(MAX(position), -1) AS n FROM caption_words WHERE bank = ?", bank);
  await db.run(
    "INSERT INTO caption_words (id, bank, word, position) VALUES (?, ?, ?, ?)",
    crypto.randomUUID(),
    bank,
    text,
    (row?.n ?? -1) + 1,
  );
}

async function rememberTemplate(body: string) {
  const text = body.trim();
  if (!text || text.length > MAX_TEMPLATE) return;
  const db = await getSql();
  const existing = await db.get("SELECT 1 AS n FROM caption_templates WHERE body = ?", text);
  if (existing) return;
  const row = await db.get<{ n: number }>("SELECT COALESCE(MAX(position), -1) AS n FROM caption_templates");
  await db.run(
    "INSERT INTO caption_templates (id, body, position) VALUES (?, ?, ?)",
    crypto.randomUUID(),
    text,
    (row?.n ?? -1) + 1,
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

export async function blockedCaptionKeys() {
  const db = await getSql();
  const keys = new Set<string>();
  const remembered = await db.all<{ caption_key: string }>("SELECT caption_key FROM used_captions");
  for (const row of remembered) keys.add(row.caption_key);
  const live = await db.all<{ caption: string }>("SELECT caption FROM reels WHERE status IN ('draft', 'approved')");
  for (const row of live) {
    const key = captionKey(row.caption);
    if (key) keys.add(key);
  }
  return keys;
}

export async function rememberCaption(caption: string) {
  const key = captionKey(caption);
  if (!key) return;
  const db = await getSql();
  await db.run("INSERT OR IGNORE INTO used_captions (caption_key) VALUES (?)", key);
}

export async function captionUsedOnCard(id: string, status: string, caption: string) {
  const key = captionKey(caption);
  if (!key) return false;
  const db = await getSql();
  const others = await db.all<{ caption: string }>(
    "SELECT caption FROM reels WHERE status IN ('draft', 'approved') AND id != ?",
    id,
  );
  if (others.some((row) => captionKey(row.caption) === key)) return true;
  if (status !== "draft") return false;
  const remembered = await db.get("SELECT 1 AS n FROM used_captions WHERE caption_key = ?", key);
  return Boolean(remembered);
}

async function slotForWord(word: string, pos: string, nouns: Set<string>, verbs: Set<string>) {
  const lower = word.toLowerCase();
  if (lower === "he" || lower === "she") return "{he/she}";
  if (lower === "him" || lower === "her") return "{him/her}";
  if (lower === "his") return "{his/her}";
  if (CLOSED.has(lower)) return word;
  if (verbs.has(lower)) return "{verb}";
  if (nouns.has(lower)) return "{noun}";
  if (pos.startsWith("VB")) {
    await rememberWord("verb", lower, verbs);
    return "{verb}";
  }
  if (pos.startsWith("NN")) {
    await rememberWord("noun", lower, nouns);
    return "{noun}";
  }
  return word;
}

export async function learnLine(line: string) {
  const pieces = line.match(PIECE) ?? [line];
  const words = pieces.filter((piece) => WORD.test(piece));
  const poses = posesForWords(words);
  const desk = await captionDesk();
  const nouns = new Set(desk.nouns.map((entry) => entry.text.toLowerCase()));
  const verbs = new Set(desk.verbs.map((entry) => entry.text.toLowerCase()));
  let wordIndex = 0;
  let body = "";
  for (const piece of pieces) {
    if (piece.startsWith("{") && piece.endsWith("}")) {
      body += piece;
      continue;
    }
    if (!WORD.test(piece)) {
      body += piece;
      continue;
    }
    const pos = poses[wordIndex] ?? "";
    wordIndex += 1;
    body += await slotForWord(piece, pos, nouns, verbs);
  }
  await rememberTemplate(body);
}

function tokenChoices(token: string, nouns: string[], verbs: string[]) {
  if (token === "{noun}") return nouns.length ? nouns : null;
  if (token === "{verb}") return verbs.length ? verbs : null;
  if (token === "{he/she}") return ["he", "she"];
  if (token === "{him/her}") return ["him", "her"];
  if (token === "{his/her}") return ["his", "her"];
  return null;
}

function* fillsOf(template: string, nouns: string[], verbs: string[]) {
  const tokens = template.match(new RegExp(TOKEN.source, "g")) ?? [];
  if (tokens.length === 0) {
    yield template;
    return;
  }
  const options = tokens.map((token) => tokenChoices(token, nouns, verbs));
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

export async function nextLine(exclude: string[] = []) {
  const desk = await captionDesk();
  if (desk.templates.length === 0) {
    throw new CaptionError("Add a caption template before generating a line.");
  }
  const nouns = desk.nouns.map((entry) => entry.text);
  const verbs = desk.verbs.map((entry) => entry.text);
  const blocked = await blockedCaptionKeys();
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
    for (const line of fillsOf(template.text, nouns, verbs)) {
      produced = true;
      if (!blocked.has(captionKey(line))) return line;
    }
  }
  if (!produced) {
    const needsNoun = desk.templates.some((entry) => entry.text.includes("{noun}"));
    const needsVerb = desk.templates.some((entry) => entry.text.includes("{verb}"));
    if (needsNoun && nouns.length === 0) throw new CaptionError("Add a noun. A template uses {noun}.");
    if (needsVerb && verbs.length === 0) {
      throw new CaptionError("Add a verb. A template uses {verb}.");
    }
    throw new CaptionError("Those templates could not be filled.");
  }
  throw new CaptionError("Every caption from these templates has already been used.");
}
