import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PHOTO_DIR, RENDER_DIR, ensureDataDirs } from "@/lib/paths";
import type { Motion } from "@/lib/types";

const OUT_W = 1080;
const OUT_H = 1920;
const FPS = 30;
const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/noto/NotoSerif-Italic.ttf",
  "/usr/share/fonts/truetype/noto/NotoSerif-Regular.ttf",
];

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
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
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
  const textPath = path.join(
    RENDER_DIR,
    `line-${path.basename(input.outputPath, ".mp4")}.txt`,
  );
  fs.writeFileSync(textPath, lines.join("\n").replace(/%/g, "%%"), "utf8");

  const font = escapeFilterPath(fontFile());
  const text = escapeFilterPath(textPath);
  const type =
    `drawbox=x=0:y=ih*0.58:w=iw:h=ih*0.14:color=black@0.22:t=fill,` +
    `drawbox=x=0:y=ih*0.70:w=iw:h=ih*0.30:color=black@0.48:t=fill,` +
    `drawtext=fontfile='${font}':textfile='${text}':fontsize=${size}:fontcolor=white:` +
    `line_spacing=14:x=(w-text_w)/2:y=h-text_h-210:shadowcolor=black@0.7:shadowx=0:shadowy=3,` +
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
      "veryfast",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      partial,
    ]);
    const stat = fs.statSync(partial);
    if (stat.size < 1000) {
      throw new Error("ffmpeg wrote an empty reel.");
    }
    fs.renameSync(partial, input.outputPath);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  } finally {
    fs.rmSync(textPath, { force: true });
  }
}
