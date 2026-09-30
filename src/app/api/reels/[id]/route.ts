import { NextResponse } from "next/server";
import { CaptionError } from "@/lib/captions";
import {
  DeskError,
  approveReel,
  changeMusic,
  regenerateLine,
  regenerateMotion,
  retryPublish,
  retryRender,
  setAudio,
  skipReel,
  updateDraft,
} from "@/lib/desk";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  try {
    const body = (await request.json()) as {
      action?: string;
      line?: unknown;
      caption?: unknown;
      captionCustom?: unknown;
      audio?: unknown;
    };
    switch (body.action) {
      case "update":
        return json(
          await updateDraft(id, {
            line: body.line,
            caption: body.caption,
            captionCustom: body.captionCustom,
          }),
        );
      case "set-audio":
        return json(await setAudio(id, body.audio));
      case "regenerate-line":
        return json(await regenerateLine(id));
      case "regenerate-motion":
        return json(await regenerateMotion(id));
      case "change-music":
        return json(await changeMusic(id));
      case "retry-render":
        return json(await retryRender(id));
      case "approve":
        return json(await approveReel(id));
      case "retry-publish":
        return json(await retryPublish(id));
      case "skip":
        return json(await skipReel(id));
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    if (error instanceof DeskError || error instanceof CaptionError) {
      return json({ error: error.message }, error.status);
    }
    const message = error instanceof Error ? error.message : "The desk hit a snag.";
    return json({ error: message }, 500);
  }
}
