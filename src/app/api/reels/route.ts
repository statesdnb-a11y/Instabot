import { NextResponse } from "next/server";
import { DeskError, deskPayload } from "@/lib/desk";
import { bootQueue, fillQueue } from "@/lib/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function GET() {
  try {
    bootQueue();
    return json(deskPayload());
  } catch (error) {
    const message = error instanceof Error ? error.message : "The desk could not load.";
    return json({ error: message }, 500);
  }
}

export async function POST(request: Request) {
  try {
    bootQueue();
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    const extra = body.mode === "one" ? 1 : 0;
    const before = deskPayload().reels.filter((reel) => reel.status === "draft").length;
    if (extra === 0 && before >= 5) {
      fillQueue(1);
    } else {
      fillQueue(extra);
    }
    return json(deskPayload());
  } catch (error) {
    if (error instanceof DeskError) return json({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "Could not generate a reel.";
    return json({ error: message }, 500);
  }
}
