import { NextResponse } from "next/server";
import { searchStudioStills } from "@/lib/photo-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const exclude = (params.get("exclude") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d+$/.test(id))
    .slice(0, 40);
  try {
    const result = await searchStudioStills({
      exclude,
      previousQuery: params.get("q"),
      count: 5,
    });
    return NextResponse.json(
      {
        query: result.query,
        stills: result.stills.map((photo) => ({
          id: photo.id,
          author: photo.author,
          sourceUrl: photo.sourceUrl,
          license: photo.license,
          imageUrl: `/api/stills/${photo.id}`,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "The photo search did not respond.";
    return NextResponse.json({ error: message }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
