import fs from "node:fs";
import path from "node:path";
import { usageCounts } from "@/lib/db";
import { blobEnabled, saveStillJpeg } from "@/lib/media";
import { PHOTOS, photoById, pickLeastUsedPhoto, type StockPhoto } from "@/lib/photos";
import { DATA_DIR, PHOTO_CACHE_DIR, ensureDataDirs } from "@/lib/paths";

const LICENSE = "Pexels License";
const LICENSE_URL = "https://www.pexels.com/license/";

export const STUDIO_QUERIES = [
  "goofy couple stock photo",
  "silly couple portrait",
  "playful funny couple",
  "couple making a funny face",
  "awkward couple photo",
  "couple being silly together",
] as const;

type Candidate = {
  id: string;
  alt: string;
  slug: string;
  username: string;
  author?: string;
  sourceUrl?: string;
};

function nextQuery(previous: string | null) {
  const choices = STUDIO_QUERIES.filter((query) => query !== previous);
  const pool = choices.length > 0 ? choices : [...STUDIO_QUERIES];
  return pool[Math.floor(Math.random() * pool.length)] ?? STUDIO_QUERIES[0];
}

function sceneText(candidate: Pick<Candidate, "alt" | "slug">) {
  return `${candidate.alt} ${candidate.slug}`.toLowerCase();
}

function usable(candidate: Pick<Candidate, "alt" | "slug">) {
  const text = sceneText(candidate);
  const couple = /couple|bride|groom|newlywed|man and woman|two people/;
  const drop =
    /outdoor|street|beach|\bpark\b|sunset|garden|motorcycle|\bbike\b|nature|forest|ocean|\blake\b|mountain|silhouette|museum|gallery|architecture|\bhorse\b|\bsnow\b|at night|dark background|monochrome|grayscale/;
  return couple.test(text) && !drop.test(text);
}

function indexPath() {
  return path.join(DATA_DIR, "photo-index.json");
}

function loadIndex(): StockPhoto[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath(), "utf8")) as StockPhoto[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((photo) => photo && typeof photo.id === "string")
      .map((photo) => ({
        ...photo,
        pair: photo.pair || photo.username || photo.id,
      }));
  } catch {
    return [];
  }
}

function rememberPhoto(photo: StockPhoto) {
  const photos = loadIndex().filter((item) => item.id !== photo.id);
  photos.push(photo);
  fs.writeFileSync(indexPath(), JSON.stringify(photos));
}

export function findPhoto(id: string) {
  return photoById(id) ?? loadIndex().find((photo) => photo.id === id) ?? null;
}

async function readText(url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("The photo search did not respond.");
  return response.text();
}

function parseJina(markdown: string): Candidate[] {
  const downloads = new Map<string, string>();
  for (const match of markdown.matchAll(/dl=pexels-(.+)-(\d+)\.jpg/g)) {
    const id = match[2];
    const username = match[1];
    if (id && username) downloads.set(id, username);
  }
  const found: Candidate[] = [];
  const image =
    /\[!\[Image \d+: Free ([^\]]+)\]\(https:\/\/images\.pexels\.com\/photos\/(\d+)\/[^)]*\)\]\(https:\/\/www\.pexels\.com\/photo\/([a-z0-9-]+)\/\)/g;
  for (const match of markdown.matchAll(image)) {
    const alt = match[1];
    const id = match[2];
    const slug = match[3];
    const username = id ? downloads.get(id) : undefined;
    if (!alt || !id || !slug || !username || !usable({ alt, slug })) continue;
    found.push({
      id,
      alt,
      slug,
      username,
      sourceUrl: `https://www.pexels.com/photo/${slug}/`,
    });
  }
  return found;
}

async function searchJina(query: string, page: number) {
  const target = `https://www.pexels.com/search/${encodeURIComponent(query)}/?page=${page}`;
  const markdown = await readText(`https://r.jina.ai/${target}`, { Accept: "text/plain" });
  if (/just a moment/i.test(markdown.slice(0, 400))) return [];
  return parseJina(markdown);
}

async function searchApi(query: string, page: number, key: string) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=40&page=${page}`;
  const response = await fetch(url, {
    headers: { Authorization: key, Accept: "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as {
    photos?: Array<{
      id: number;
      alt: string | null;
      photographer: string;
      photographer_url: string;
      url: string;
    }>;
  };
  const found: Candidate[] = [];
  for (const photo of data.photos ?? []) {
    const alt = photo.alt ?? "";
    const id = String(photo.id);
    const slug = photo.url.match(/\/photo\/([^/]+)\/?$/)?.[1] ?? id;
    if (!usable({ alt, slug })) continue;
    const username = photo.photographer_url.match(/@([^/]+)\/?$/)?.[1] || photo.photographer;
    found.push({
      id,
      alt,
      slug,
      username,
      author: photo.photographer,
      sourceUrl: photo.url,
    });
  }
  return found;
}

async function downloadJpeg(id: string) {
  const file = path.join(PHOTO_CACHE_DIR, `studio-${id}.jpg`);
  if (fs.existsSync(file) && fs.statSync(file).size > 8000) return file;
  const url = `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=1600`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "image/jpeg" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error("download");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 8000) throw new Error("download");
  fs.writeFileSync(file, bytes);
  return file;
}

function displayAuthor(candidate: Candidate) {
  if (candidate.author) return candidate.author;
  const parts = candidate.username.split("-").filter((part) => part && !/^\d+$/.test(part));
  if (parts.length === 0) return "Pexels";
  return parts.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function toStock(candidate: Candidate, author: string): StockPhoto {
  return {
    id: candidate.id,
    pair: candidate.username,
    author,
    username: candidate.username,
    file: `studio-${candidate.id}.jpg`,
    sourceUrl: candidate.sourceUrl ?? `https://www.pexels.com/photo/${candidate.slug}/`,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
  };
}

export async function searchStudioStills(options: {
  exclude?: string[];
  previousQuery?: string | null;
  count?: number;
}) {
  ensureDataDirs();
  const count = options.count ?? 5;
  const exclude = new Set(options.exclude ?? []);
  const query = nextQuery(options.previousQuery ?? null);
  const page = 1 + Math.floor(Math.random() * 3);
  const key = process.env.PEXELS_API_KEY?.trim();
  async function loadPage(term: string, pageNumber: number) {
    if (key) {
      const api = await searchApi(term, pageNumber, key);
      if (api.length > 0) return api;
    }
    return searchJina(term, pageNumber);
  }
  const pooled: Candidate[] = [];
  const seenId = new Set<string>();
  const addAll = (batch: Candidate[]) => {
    for (const candidate of batch) {
      if (seenId.has(candidate.id)) continue;
      seenId.add(candidate.id);
      pooled.push(candidate);
    }
  };
  addAll(await loadPage(query, page));
  if (pooled.length < 8) addAll(await loadPage(query, page === 1 ? 2 : 1));
  const stills: StockPhoto[] = [];
  const seenUser = new Set<string>();
  let tried = 0;
  for (let index = 0; index < pooled.length && stills.length < count && tried < 12; index += 4) {
    const batch = pooled.slice(index, index + 4).filter((candidate) => {
      if (!/^\d+$/.test(candidate.id) || exclude.has(candidate.id) || seenUser.has(candidate.username)) return false;
      seenUser.add(candidate.username);
      return true;
    });
    tried += batch.length;
    const checked = await Promise.all(
      batch.map(async (candidate) => {
        try {
          const file = await downloadJpeg(candidate.id);
          const photo = toStock(candidate, displayAuthor(candidate));
          if (blobEnabled()) {
            const imageUrl = await saveStillJpeg(candidate.id, fs.readFileSync(file)).catch(() => null);
            if (imageUrl) photo.imageUrl = imageUrl;
          }
          return photo;
        } catch {
          return null;
        }
      }),
    );
    for (const photo of checked) {
      if (!photo || stills.length >= count) continue;
      rememberPhoto(photo);
      stills.push(photo);
    }
  }
  if (stills.length === 0) {
    const saved = pickStudioStillsFallback(exclude, count);
    if (saved.length === 0) throw new Error("The photo search did not return a couple.");
    return { query, stills: saved, live: false };
  }
  return { query, stills, live: true };
}

function pickStudioStillsFallback(exclude: Set<string>, count: number) {
  const picked: StockPhoto[] = [];
  const seen = new Set<string>();
  const bundled = [...PHOTOS];
  for (let index = bundled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = bundled[index];
    bundled[index] = bundled[swap] ?? current;
    bundled[swap] = current;
  }
  for (const photo of bundled) {
    if (picked.length >= count) break;
    if (exclude.has(photo.id) || seen.has(photo.username)) continue;
    seen.add(photo.username);
    picked.push(photo);
  }
  return picked;
}

let freshPool: StockPhoto[] = [];
let freshQuery = "";

export async function takeStudioPhoto() {
  if (freshPool.length === 0) {
    try {
      const batch = await searchStudioStills({ count: 5, previousQuery: freshQuery || null });
      freshPool = batch.stills;
      freshQuery = batch.query;
    } catch {
      freshPool = [];
    }
  }
  const photo = freshPool.shift();
  if (photo) return photo;
  return pickLeastUsedPhoto(await usageCounts("photo_id"));
}
