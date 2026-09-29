import { NextResponse } from "next/server";
import {
  CaptionError,
  addTemplate,
  addWord,
  captionDesk,
  deleteTemplate,
  deleteWord,
  flipBlank,
  flipWord,
} from "@/lib/captions";

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
    return json(captionDesk());
  } catch (error) {
    const message = error instanceof Error ? error.message : "The captions could not load.";
    return json({ error: message }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      id?: unknown;
      text?: unknown;
      bank?: unknown;
      index?: unknown;
    };
    switch (body.action) {
      case "add-template":
        return json(addTemplate(body.text));
      case "delete-template":
        return json(deleteTemplate(body.id));
      case "add-word":
        return json(addWord(body.bank, body.text));
      case "delete-word":
        return json(deleteWord(body.id));
      case "flip-blank":
        return json(flipBlank(body.id, body.index));
      case "flip-word":
        return json(flipWord(body.id));
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    if (error instanceof CaptionError) return json({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "The captions could not be saved.";
    return json({ error: message }, 500);
  }
}
