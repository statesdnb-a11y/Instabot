import { NextResponse } from "next/server";
import { pickStudioStills } from "@/lib/photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("exclude") ?? "";
  const exclude = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 20);
  const stills = pickStudioStills(exclude, 5).map((photo) => ({
    id: photo.id,
    author: photo.author,
    sourceUrl: photo.sourceUrl,
    license: photo.license,
    imageUrl: `/api/stills/${photo.id}`,
  }));
  return NextResponse.json(
    { stills },
    { headers: { "Cache-Control": "no-store" } },
  );
}
