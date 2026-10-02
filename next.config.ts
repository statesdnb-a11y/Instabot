import type { NextConfig } from "next";

const ffmpegTrace = ["./node_modules/ffmpeg-static/**/*", "./assets/**/*"];
const photoTrace = ["./data/photos/**/*"];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "wink-pos-tagger", "ffmpeg-static", "@libsql/client"],
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/reels": [...ffmpegTrace, ...photoTrace],
    "/api/reels/[id]": [...ffmpegTrace, ...photoTrace],
    "/api/reels/[id]/poster": photoTrace,
  },
  outputFileTracingExcludes: {
    "/api/reels/[id]/poster": [...ffmpegTrace],
    "/api/reels/[id]/video": [...ffmpegTrace, ...photoTrace],
  },
};

export default nextConfig;
