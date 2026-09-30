/**
 * Saved stills used when a live Pexels search is unavailable, and for drafts
 * that already point at these files. New searches do not shuffle this list.
 * Scenic, outdoor, dark, and lifestyle-room photos are not in this set.
 */
export type StockPhoto = {
  id: string;
  author: string;
  username: string;
  file: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
};

const LICENSE = "Pexels License";
const LICENSE_URL = "https://www.pexels.com/license/";

function still(
  id: string,
  author: string,
  username: string,
  slug: string,
): StockPhoto {
  return {
    id,
    author,
    username,
    file: `studio-${id}.jpg`,
    sourceUrl: `https://www.pexels.com/photo/${slug}-${id}/`,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
  };
}

export const PHOTOS: StockPhoto[] = [
  still("8386827", "Darina Belonogova", "darina-belonogova", "woman-in-paranja-dancing-with-a-man"),
  still("8386823", "Darina Belonogova", "darina-belonogova", "man-hugging-woman-in-black-hijab"),
  still("8386812", "Darina Belonogova", "darina-belonogova", "man-hugging-a-woman-in-white-long-sleeves"),
  still("8386828", "Darina Belonogova", "darina-belonogova", "woman-in-paranja-holding-man-s-hand"),
  still("8386838", "Darina Belonogova", "darina-belonogova", "couple-standing-side-by-side"),
  still("8386317", "Darina Belonogova", "darina-belonogova", "man-hugging-woman-from-the-back"),
  still("8386318", "Darina Belonogova", "darina-belonogova", "man-hugging-woman"),
  still("8386305", "Darina Belonogova", "darina-belonogova", "a-man-and-a-woman-being-playful-in-the-studio"),
  still("8386251", "Darina Belonogova", "darina-belonogova", "a-couple-standing-near-white-background"),
  still("8386603", "Darina Belonogova", "darina-belonogova", "a-couple-in-a-hugging-pose"),
  still("6291115", "SAN Wedding", "san-wedding", "newlywed-couple-posing-for-a-photo"),
];

export function photoById(id: string) {
  return PHOTOS.find((photo) => photo.id === id) ?? null;
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swap] ?? current;
    copy[swap] = current;
  }
  return copy;
}

/** One still per photographer, so a page is not five frames of the same couple. */
export function pickStudioStills(exclude: string[] = [], count = 5) {
  const blocked = new Set(exclude);
  const picked: StockPhoto[] = [];
  const seen = new Set<string>();
  for (const photo of shuffle(PHOTOS)) {
    if (picked.length >= count) break;
    if (blocked.has(photo.id) || seen.has(photo.username)) continue;
    seen.add(photo.username);
    picked.push(photo);
  }
  return picked;
}

export function pickBundledPhoto(counts: Map<string, number>) {
  const groups = new Map<string, StockPhoto[]>();
  for (const photo of PHOTOS) {
    const list = groups.get(photo.username) ?? [];
    list.push(photo);
    groups.set(photo.username, list);
  }
  let best = Number.POSITIVE_INFINITY;
  const least: StockPhoto[][] = [];
  for (const list of groups.values()) {
    const used = list.reduce((sum, photo) => sum + (counts.get(photo.id) ?? 0), 0);
    if (used < best) {
      best = used;
      least.length = 0;
    }
    if (used === best) least.push(list);
  }
  const group = least[Math.floor(Math.random() * least.length)] ?? PHOTOS;
  return group[Math.floor(Math.random() * group.length)] ?? PHOTOS[0];
}
