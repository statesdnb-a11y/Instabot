import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { facebookLoginUrl, missingMetaEnv, STATE_COOKIE, stateCookieOptions } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function deskHome(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost?.split(",")[0]?.trim() || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || new URL(request.url).protocol.replace(":", "");
  return host ? new URL("/", `${proto}://${host}`) : new URL("/", request.url);
}

export async function GET(request: Request) {
  const missing = missingMetaEnv();
  if (missing.length > 0) {
    const url = deskHome(request);
    url.searchParams.set("instagram_error", "config");
    return NextResponse.redirect(url);
  }
  const state = randomBytes(24).toString("hex");
  const response = NextResponse.redirect(facebookLoginUrl(state));
  response.cookies.set(STATE_COOKIE, state, stateCookieOptions(60 * 10));
  return response;
}
