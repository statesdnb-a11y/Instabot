/**
 * Saved stills used when a live Pexels search is unavailable, and for drafts
 * that already point at these files. New searches do not shuffle this list.
 * Existing drafts keep the photo file already stored on the row.
 */
export type StockPhoto = {
  id: string;
  pair: string;
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
  pair: string,
  author: string,
  username: string,
  slug: string,
): StockPhoto {
  return {
    id,
    pair,
    author,
    username,
    file: `studio-${id}.jpg`,
    sourceUrl: `https://www.pexels.com/photo/${slug}-${id}/`,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
  };
}

export const PHOTOS: StockPhoto[] = [
  still("8386827", "darina", "Darina Belonogova", "darina-belonogova", "woman-in-paranja-dancing-with-a-man"),
  still("8386823", "darina", "Darina Belonogova", "darina-belonogova", "man-hugging-woman-in-black-hijab"),
  still("8386812", "darina", "Darina Belonogova", "darina-belonogova", "man-hugging-a-woman-in-white-long-sleeves"),
  still("8386828", "darina", "Darina Belonogova", "darina-belonogova", "woman-in-paranja-holding-man-s-hand"),
  still("8386838", "darina", "Darina Belonogova", "darina-belonogova", "couple-standing-side-by-side"),
  still("8386317", "darina", "Darina Belonogova", "darina-belonogova", "man-hugging-woman-from-the-back"),
  still("8386318", "darina", "Darina Belonogova", "darina-belonogova", "man-hugging-woman"),
  still("8386305", "darina", "Darina Belonogova", "darina-belonogova", "a-man-and-a-woman-being-playful-in-the-studio"),
  still("8386251", "darina", "Darina Belonogova", "darina-belonogova", "a-couple-standing-near-white-background"),
  still("8386603", "darina", "Darina Belonogova", "darina-belonogova", "a-couple-in-a-hugging-pose"),
  still("6291115", "san-wedding", "SAN Wedding", "san-wedding", "newlywed-couple-posing-for-a-photo"),
  still("13378233", "tran-long", "Trần Long", "tr-n-long-3093985", "wedding-portrait-in-white-background"),
  still("13378231", "tran-long", "Trần Long", "tr-n-long-3093985", "groom-wearing-a-black-suit"),
  still("14562168", "tran-long", "Trần Long", "tr-n-long-3093985", "woman-in-white-tube-dress-beside-man-in-beige-coat"),
  still("14562169", "tran-long", "Trần Long", "tr-n-long-3093985", "bride-and-groom-laughing-together"),
  still("14562175", "tran-long", "Trần Long", "tr-n-long-3093985", "a-bride-and-a-groom-looking-at-each-other-while-smiling"),
  still("20203126", "igor-meghega", "Igor Meghega", "igor-meghega-315695093", "couple-sitting-and-hugging-on-white-background"),
  still("15227493", "joseph-okon", "Joseph Okon", "joecreativestudio", "happy-loving-couple-in-studio"),
  still("15825598", "li-xingjia", "李 兴嘉", "463686151", "bride-and-groom-posing-in-white-studio-background"),
  still("27060170", "casper-somia", "casper somia", "caspersomia", "the-groom-kissing-the-bride-on-the-cheek"),
  still("34334181", "eduardo199o9", "eduardo199o9", "eduardo199o9-178988127", "couple-in-western-hats-and-red-outfits-portrait"),
  still("17474231", "marcos-felipe", "Marcos Felipe", "marcos-felipe-177641462", "studio-shot-of-a-woman-in-a-dress-and-man-in-tank-top-and-jeans-sitting-on-the-floor"),
  still("15604994", "jeferson-gomes", "JEFERSON GOMES", "jeferson-gomes-24831766", "young-couple-posing-together"),
  still("5325676", "anna-shvets", "Anna Shvets", "shvetsa", "happy-couple-giving-high-five"),
  still("31851977", "patricia-bozan", "Patricia Bozan", "patricia-bozan-2151752743", "romantic-couple-embracing-with-flower"),
  still("10765513", "th-team", "TH Team", "thteam", "middle-aged-couple"),
  still("7718766", "mikhail-nilov", "Mikhail Nilov", "mikhail-nilov", "a-couple-kissing"),
];

export function photoById(id: string) {
  return PHOTOS.find((photo) => photo.id === id) ?? null;
}

export function pickLeastUsedPhoto(counts: Map<string, number>) {
  const groups = new Map<string, StockPhoto[]>();
  for (const photo of PHOTOS) {
    const list = groups.get(photo.pair) ?? [];
    list.push(photo);
    groups.set(photo.pair, list);
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
  let photoBest = Number.POSITIVE_INFINITY;
  const pool: StockPhoto[] = [];
  for (const photo of group) {
    const used = counts.get(photo.id) ?? 0;
    if (used < photoBest) {
      photoBest = used;
      pool.length = 0;
    }
    if (used === photoBest) pool.push(photo);
  }
  return pool[Math.floor(Math.random() * pool.length)] ?? group[0] ?? PHOTOS[0];
}
