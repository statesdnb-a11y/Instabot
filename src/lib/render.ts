import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { PHOTO_DIR, ensureDataDirs } from "@/lib/paths";
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
  if (lineCount >= 6) return 38;
  if (lineCount >= 5) return 42;
  if (lineCount >= 4) return 46;
  return 52;
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

export async function renderReelFile(input: {
  photoFile: string;
  line: string;
  motion: Motion;
  durationSec: number;
  outputPath: string;
}) {
  ensureDataDirs();
  const photoPath = path.join(PHOTO_DIR, input.photoFile);
  if (!fs.existsSync(photoPath)) {
    throw new Error("The still for this reel is missing.");
  }

  const duration = Math.min(12, Math.max(8, Math.round(input.durationSec)));
  const frames = duration * FPS;
  const lines = wrapLine(input.line);
  const size = fontSize(lines.length);
  const assPath = path.join(path.dirname(input.outputPath), `line-${path.basename(input.outputPath, ".mp4")}.ass`);
  fs.mkdirSync(path.dirname(assPath), { recursive: true });
  fs.writeFileSync(assPath, assScript(lines, size, duration), "utf8");
  const subs = escapeFilterPath(assPath);
  const fonts = escapeFilterPath(path.dirname(fontFile()));
  const type =
    `drawbox=x=0:y=ih*0.58:w=iw:h=ih*0.14:color=black@0.22:t=fill,` +
    `drawbox=x=0:y=ih*0.70:w=iw:h=ih*0.30:color=black@0.48:t=fill,` +
    `subtitles='${subs}':fontsdir='${fonts}',` +
    `format=yuv420p[v]`;

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
      "-filter_complex",
      video,
      "-map",
      "[v]",
      "-an",
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
    if (stat.size < 1000 || !playableMp4(partial)) {
      throw new Error("ffmpeg did not write a playable mp4.");
    }
    fs.renameSync(partial, input.outputPath);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  } finally {
    fs.rmSync(assPath, { force: true });
  }
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
Style: Line,Noto Serif,${size},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,1,0,0,100,100,0,0,1,0,3,2,90,90,210,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Line,,0,0,0,,${body}
`;
}
