import fs from "node:fs";
import path from "node:path";

export const BED_TRACKS = [
  { id: "music-1", label: "Music 1", file: "music-1.m4a" },
  { id: "music-2", label: "Music 2", file: "music-2.m4a" },
  { id: "music-3", label: "Music 3", file: "music-3.m4a" },
  { id: "music-4", label: "Music 4", file: "music-4.m4a" },
  { id: "music-5", label: "Music 5", file: "music-5.m4a" },
  { id: "music-6", label: "Music 6", file: "music-6.m4a" },
  { id: "music-7", label: "Music 7", file: "music-7.m4a" },
  { id: "music-8", label: "Music 8", file: "music-8.m4a" },
  { id: "music-9", label: "Music 9", file: "music-9.m4a" },
] as const;

export type BedTrackId = (typeof BED_TRACKS)[number]["id"];

const RARE_BEDS = new Set<string>(["music-1", "music-2", "music-4"]);

/** Automatic rotation. Rare beds are half as often as the others. */
export function bedTrackWeight(id: string) {
  return RARE_BEDS.has(id) ? 1 : 2;
}

export function nextWeightedBed(remaining: ReadonlyMap<string, number>, avoid: string | null) {
  const start = avoid ? BED_TRACKS.findIndex((track) => track.id === avoid) : -1;
  for (let step = 1; step <= BED_TRACKS.length; step += 1) {
    const track = BED_TRACKS[(start + step) % BED_TRACKS.length];
    if (!track || track.id === avoid) continue;
    if ((remaining.get(track.id) ?? 0) > 0) return track;
  }
  return null;
}

export function pickBedTrack() {
  return BED_TRACKS[Math.floor(Math.random() * BED_TRACKS.length)];
}

export function bedTrackById(id: string | null | undefined) {
  if (!id) return null;
  return BED_TRACKS.find((track) => track.id === id) ?? null;
}

export function bedTrackPath(id: string) {
  const track = bedTrackById(id);
  if (!track) throw new Error("That music track is not on the desk.");
  const file = path.join(process.cwd(), "assets", "music", track.file);
  if (!fs.existsSync(file)) throw new Error(`${track.label} is missing from the app.`);
  return file;
}
