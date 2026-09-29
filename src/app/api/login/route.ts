import { NextResponse } from "next/server";
import { AUTH_COOKIE, passwordRequired, safeEqual, sessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!passwordRequired()) {
    return NextResponse.json({ ok: true, open: true });
  }
  const body = (await request.json().catch(() => ({}))) as { password?: string };
  const password = typeof body.password === "string" ? body.password : "";
  const expected = await sessionToken(process.env.INSTABOT_PASSWORD ?? "");
  const got = await sessionToken(password);
  if (!safeEqual(got, expected)) {
    return NextResponse.json(
      { error: "That passphrase doesn't open the desk." },
      { status: 401 },
    );
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(AUTH_COOKIE, expected, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
