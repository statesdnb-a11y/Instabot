import { NextResponse } from "next/server";
import { searchMusic } from "@/lib/audio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? undefined;
  const result = await searchMusic(query);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
