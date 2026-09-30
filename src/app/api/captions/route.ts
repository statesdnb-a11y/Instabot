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
  nextLine,
} from "@/lib/captions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET() {
  try {
    return json(await captionDesk());
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
        return json(await addTemplate(body.text));
      case "delete-template":
        return json(await deleteTemplate(body.id));
      case "add-word":
        return json(await addWord(body.bank, body.text));
      case "delete-word":
        return json(await deleteWord(body.id));
      case "flip-blank":
        return json(await flipBlank(body.id, body.index));
      case "flip-word":
        return json(await flipWord(body.id));
      case "generate":
        return json({ line: await nextLine(typeof body.text === "string" ? [body.text] : []) });
      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (error) {
    if (error instanceof CaptionError) return json({ error: error.message }, error.status);
    const message = error instanceof Error ? error.message : "The captions could not be saved.";
    return json({ error: message }, 500);
  }
}
