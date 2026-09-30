import { NextResponse } from "next/server";
import { pickStudioStills } from "@/lib/photos";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const exclude = (params.get("exclude") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id))
    .slice(0, 40);
  const { query, stills } = pickStudioStills(exclude, 5, params.get("q"));
  return NextResponse.json(
    {
      query,
      stills: stills.map((photo) => ({
        id: photo.id,
        author: photo.author,
        sourceUrl: photo.sourceUrl,
        license: photo.license,
        imageUrl: `/api/stills/${photo.id}`,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
