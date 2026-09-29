/**
 * Bundled two-person stills. Unsplash License.
 * Swap this list to change the desk's image set. Optional Unsplash/Pexels
 * API keys are not required and are not called.
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

export const PHOTOS: StockPhoto[] = [
  {
    id: "PR8V3-7_rY8",
    author: "Lauren Rader",
    username: "laurenraderphoto",
    file: "lauren-rader-boulder.jpg",
    sourceUrl: "https://unsplash.com/photos/PR8V3-7_rY8",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
  },
  {
    id: "X709gAFk81U",
    author: "Cameron Stewart",
    username: "cameronstewart",
    file: "cameron-stewart-waterfall.jpg",
    sourceUrl: "https://unsplash.com/photos/X709gAFk81U",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
  },
  {
    id: "iAncWttLgf4",
    author: "Hanna Morris",
    username: "hcmorr",
    file: "hanna-morris-mugs.jpg",
    sourceUrl: "https://unsplash.com/photos/iAncWttLgf4",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
  },
  {
    id: "FApniXFOJU4",
    author: "JD Chow",
    username: "colnago",
    file: "jd-chow-shore.jpg",
    sourceUrl: "https://unsplash.com/photos/FApniXFOJU4",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
  },
  {
    id: "es-OB2FzzNY",
    author: "JJ ROCHA",
    username: "that_person",
    file: "jj-rocha-kiss.jpg",
    sourceUrl: "https://unsplash.com/photos/es-OB2FzzNY",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
  },
  {
    id: "80_6jJ97c-U",
    author: "Andrey Câmara",
    username: "andreycamara",
    file: "andrey-camara-hug.jpg",
    sourceUrl: "https://unsplash.com/photos/80_6jJ97c-U",
    license: "Unsplash License",
    licenseUrl: "https://unsplash.com/license",
  },
];

export function photoById(id: string) {
  return PHOTOS.find((photo) => photo.id === id) ?? null;
}
