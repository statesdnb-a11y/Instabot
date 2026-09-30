import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { facebookLoginUrl, missingMetaEnv, missingMetaMessage, STATE_COOKIE, stateCookieOptions } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const missing = missingMetaEnv();
  if (missing.length > 0) {
    return NextResponse.json(
      { error: missingMetaMessage(missing) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(facebookLoginUrl(state));
  response.cookies.set(STATE_COOKIE, state, stateCookieOptions(60 * 10));
  return response;
}
