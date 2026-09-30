/**
 * Stills for new reels. Pexels License.
 * Search terms: candid couple white background, playful couple white seamless
 * studio, couple full body white backdrop, two people white studio background.
 * Scenic, outdoor, dark, and lifestyle-room photos are not in this set.
 * Existing drafts keep the photo file already stored on the row.
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

export const STUDIO_QUERIES = [
  "candid couple white background",
  "playful couple white seamless studio",
  "couple full body white backdrop",
  "two people white studio background",
] as const;

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

export function pickStudioStills(exclude: string[] = [], count = 5) {
  const blocked = new Set(exclude);
  const shuffled = [...PHOTOS];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swap] ?? current;
    shuffled[swap] = current;
  }
  const fresh = shuffled.filter((photo) => !blocked.has(photo.id));
  const picked = fresh.slice(0, count);
  if (picked.length >= count) return picked;
  for (const photo of shuffled) {
    if (picked.length >= count) break;
    if (!picked.some((item) => item.id === photo.id)) picked.push(photo);
  }
  return picked;
}
