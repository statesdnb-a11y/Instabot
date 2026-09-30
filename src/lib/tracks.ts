import fs from "node:fs";
import path from "node:path";

export const BED_TRACKS = [
  { id: "music-1", label: "Music 1", file: "music-1.m4a" },
  { id: "music-2", label: "Music 2", file: "music-2.m4a" },
  { id: "music-3", label: "Music 3", file: "music-3.m4a" },
] as const;

export type BedTrackId = (typeof BED_TRACKS)[number]["id"];

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
