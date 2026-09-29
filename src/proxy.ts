import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, passwordRequired, safeEqual, sessionToken } from "@/lib/session";

export async function proxy(request: NextRequest) {
  if (!passwordRequired()) return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/login")) {
    return NextResponse.next();
  }

  const expected = await sessionToken(process.env.INSTABOT_PASSWORD ?? "");
  const got = request.cookies.get(AUTH_COOKIE)?.value ?? "";
  if (got && safeEqual(got, expected)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "This desk is locked." }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
