import { NextResponse } from "next/server";
import { CaptionError } from "@/lib/captions";
import { DeskError, deskPayload } from "@/lib/desk";
import { onVercel } from "@/lib/media";
import { bootQueue, createDraft, fillQueue, renderOne } from "@/lib/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  try {
    await bootQueue();
    return json(await deskPayload());
  } catch (error) {
    const message = error instanceof Error ? error.message : "The desk could not load.";
    return json({ error: message }, 500);
  }
}

export async function POST(request: Request) {
  try {
    await bootQueue();
    const body = (await request.json().catch(() => ({}))) as { mode?: string };
    if (onVercel()) {
      const id = await createDraft();
      await renderOne(id);
    } else {
      const extra = body.mode === "one" ? 1 : 0;
      const before = (await deskPayload()).reels.filter((reel) => reel.status === "draft").length;
      if (extra === 0 && before >= 5) await fillQueue(1);
      else await fillQueue(extra);
    }
    return json(await deskPayload());
  } catch (error) {
    if (error instanceof DeskError || error instanceof CaptionError) {
      return json({ error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : "Could not generate a reel.";
    return json({ error: message }, 500);
  }
}
