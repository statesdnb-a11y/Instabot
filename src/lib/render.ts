import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { ensureDataDirs, resolvePhotoFile } from "@/lib/paths";
import { bedTrackPath } from "@/lib/tracks";
import type { Motion } from "@/lib/types";

const require = createRequire(import.meta.url);

const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const FONT_CANDIDATES = [
  path.join(process.cwd(), "assets", "NotoSerif-Italic.ttf"),
  "/usr/share/fonts/truetype/noto/NotoSerif-Italic.ttf",
  "/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf",
];

function ffmpegBin() {
  let bundled: string | null = null;
  try {
    const resolved = require("ffmpeg-static") as string | null;
    if (resolved && fs.existsSync(resolved)) bundled = resolved;
  } catch {
    bundled = null;
  }
  if (bundled) {
    try {
      fs.accessSync(bundled, fs.constants.X_OK);
      return bundled;
    } catch {
      const copy = "/tmp/instabot-ffmpeg";
      if (!fs.existsSync(copy)) {
        fs.copyFileSync(bundled, copy);
        fs.chmodSync(copy, 0o755);
      }
      return copy;
    }
  }
  if (process.env.VERCEL === "1") {
    throw new Error("ffmpeg is not included on this host, so the reel cannot be cut.");
  }
  return "ffmpeg";
}

function even(value: number) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

function fontFile() {
  const found = FONT_CANDIDATES.find((file) => fs.existsSync(file));
  if (!found) {
    throw new Error("No serif font found for the on-screen line.");
  }
  return found;
}

function escapeFilterPath(filePath: string) {
  return filePath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function wrapLine(text: string, width = 28) {
  const words = text.trim().replace(/\s+/g, " ").split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function fontSize(lineCount: number) {
  if (lineCount >= 8) return 48;
  if (lineCount >= 6) return 58;
  if (lineCount >= 5) return 66;
  if (lineCount >= 4) return 76;
  if (lineCount >= 3) return 86;
  return 96;
}

function captionBlock(lineCount: number, size: number) {
  return 88 + lineCount * Math.round(size * 1.2) + 48;
}

function layoutCaption(text: string) {
  const widths = [20, 22, 24, 26, 28];
  let chosen = { lines: wrapLine(text, widths[0]), size: fontSize(1) };
  for (const width of widths) {
    const lines = wrapLine(text, width);
    const size = fontSize(lines.length);
    chosen = { lines, size };
    if (captionBlock(lines.length, size) <= 630) return chosen;
  }
  while (chosen.size > 42 && captionBlock(chosen.lines.length, chosen.size) > 630) {
    chosen = { lines: chosen.lines, size: chosen.size - 4 };
  }
  return chosen;
}

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegBin(), args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-8000);
    });
    child.on("error", (error) => {
      reject(
        error.message.includes("ENOENT")
          ? new Error("ffmpeg is not installed.")
          : error,
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().slice(-700) || `ffmpeg exited ${code}`));
    });
  });
}

export async function muxBedAudio(videoPath: string, bedTrack: string, outputPath: string) {
  const audioPath = bedTrackPath(bedTrack);
  const partial = `${outputPath}.part.mp4`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      videoPath,
      "-stream_loop",
      "-1",
      "-i",
      audioPath,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-shortest",
      "-movflags",
      "+faststart",
      partial,
    ]);
    if (!playableMp4(partial) || !(await fileHasAudio(partial))) {
      throw new Error("The reel was saved without its music track.");
    }
    fs.renameSync(partial, outputPath);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
}

export const STILL_GONE = "This reel's still is already gone.";

export async function renderReelFile(input: {
  photoFile: string;
  photoPath?: string;
  line: string;
  motion: Motion;
  durationSec: number;
  outputPath: string;
  bedTrack?: string | null;
}) {
  ensureDataDirs();
  const photoPath =
    input.photoPath && fs.existsSync(input.photoPath) ? input.photoPath : resolvePhotoFile(input.photoFile);
  if (!photoPath) {
    throw new Error(STILL_GONE);
  }

  const duration = Math.min(12, Math.max(8, Math.round(input.durationSec)));
  const frames = duration * FPS;
  const assPath = path.join(path.dirname(input.outputPath), `line-${path.basename(input.outputPath, ".mp4")}.ass`);
  fs.mkdirSync(path.dirname(assPath), { recursive: true });
  fs.writeFileSync(assPath, captionAss(input.line, duration), "utf8");
  const subs = escapeFilterPath(assPath);
  const fonts = escapeFilterPath(path.dirname(fontFile()));
  const type = `subtitles='${subs}':fontsdir='${fonts}',format=yuv420p[v]`;

  let video: string;
  if (input.motion === "pan") {
    const canvasW = even(OUT_W * 1.06);
    const canvasH = even(OUT_H * 1.06);
    video =
      `[0:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase:flags=bilinear,` +
      `crop=${canvasW}:${canvasH},fps=${FPS},` +
      `crop=w=${OUT_W}:h=${OUT_H}:` +
      `x='trunc(((in_w-${OUT_W})/2+(in_w-${OUT_W})*0.28*((n/${frames})-0.5)*2)/2)*2':` +
      `y='trunc(((in_h-${OUT_H})/2)/2)*2',` +
      `scale=${OUT_W}:${OUT_H}:flags=bilinear,${type}`;
  } else {
    const canvasW = even(OUT_W * 1.08);
    const canvasH = even(OUT_H * 1.08);
    video =
      `[0:v]scale=${canvasW}:${canvasH}:force_original_aspect_ratio=increase:flags=bilinear,` +
      `crop=${canvasW}:${canvasH},fps=${FPS},` +
      `crop=w='trunc((${canvasW}-(${canvasW}-${OUT_W})*n/${frames})/2)*2':` +
      `h='trunc((${canvasH}-(${canvasH}-${OUT_H})*n/${frames})/2)*2':` +
      `x='(in_w-ow)/2':y='(in_h-oh)/2',` +
      `scale=${OUT_W}:${OUT_H}:flags=bilinear,${type}`;
  }

  const audioPath = input.bedTrack ? bedTrackPath(input.bedTrack) : null;
  const partial = `${input.outputPath}.part.mp4`;
  fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
  try {
    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-framerate",
      String(FPS),
      "-i",
      photoPath,
      ...(audioPath ? ["-stream_loop", "-1", "-i", audioPath] : []),
      "-filter_complex",
      video,
      "-map",
      "[v]",
      ...(audioPath ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"] : ["-an"]),
      "-t",
      String(duration),
      "-r",
      String(FPS),
      "-c:v",
      "libx264",
      "-preset",
      process.env.VERCEL ? "ultrafast" : "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      partial,
    ]);
    const stat = fs.statSync(partial);
    if (stat.size < 1000 || !playableMp4(partial) || (audioPath && !(await fileHasAudio(partial)))) {
      throw new Error(audioPath ? "ffmpeg did not write the music into the mp4." : "ffmpeg did not write a playable mp4.");
    }
    fs.renameSync(partial, input.outputPath);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  } finally {
    fs.rmSync(assPath, { force: true });
  }
}

function fileHasAudio(filePath: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn(
      ffmpegBin(),
      ["-hide_banner", "-loglevel", "error", "-i", filePath, "-map", "0:a:0", "-f", "null", "-t", "0.2", "-"],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

function playableMp4(filePath: string) {
  const fd = fs.openSync(filePath, "r");
  try {
    const header = Buffer.alloc(12);
    const read = fs.readSync(fd, header, 0, 12, 0);
    return read >= 12 && header.subarray(4, 8).toString("ascii") === "ftyp";
  } finally {
    fs.closeSync(fd);
  }
}

function assEscape(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

export function captionAss(line: string, duration: number) {
  const { lines, size } = layoutCaption(line);
  return assScript(lines, size, duration);
}

function assScript(lines: string[], size: number, duration: number) {
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const end = `0:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.00`;
  const body = lines.map(assEscape).join("\\N");
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Line,Noto Serif,${size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,1,0,0,100,100,0,0,1,6,2,8,72,72,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Line,,0,0,0,,${body}
`;
}
