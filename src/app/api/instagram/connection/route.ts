import { NextResponse } from "next/server";
import { disconnectInstagram } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE() {
  await disconnectInstagram();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
