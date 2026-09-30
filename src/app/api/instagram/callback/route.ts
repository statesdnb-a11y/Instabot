import { NextResponse } from "next/server";
import { completeInstagramLogin, oauthStateMatches, STATE_COOKIE, stateCookieOptions } from "@/lib/meta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readCookie(header: string, name: string) {
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1));
    } catch {
      return "";
    }
  }
  return "";
}

function back(request: Request, error?: string) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost?.split(",")[0]?.trim() || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || new URL(request.url).protocol.replace(":", "");
  const url = host ? new URL("/", `${proto}://${host}`) : new URL("/", request.url);
  if (error) url.searchParams.set("instagram_error", error);
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, "", stateCookieOptions(0));
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("error")) {
    const denied = url.searchParams.get("error") === "access_denied";
    return back(request, denied ? "denied" : "exchange");
  }
  const state = url.searchParams.get("state") ?? "";
  const expected = readCookie(request.headers.get("cookie") ?? "", STATE_COOKIE);
  if (!oauthStateMatches(expected, state)) return back(request, "state");
  const code = url.searchParams.get("code") ?? "";
  const result = await completeInstagramLogin(code);
  if (result !== "ok") return back(request, result);
  return back(request);
}
