import type { NextConfig } from "next";

const traced = ["./data/photos/**/*", "./assets/**/*", "./node_modules/ffmpeg-static/**/*"];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "wink-pos-tagger", "ffmpeg-static", "@libsql/client"],
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/reels": traced,
    "/api/reels/[id]": traced,
    "/api/reels/[id]/poster": traced,
    "/api/reels/[id]/video": traced,
  },
};

export default nextConfig;
