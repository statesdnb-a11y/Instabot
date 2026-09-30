import { clearInstagramConnection, getInstagramConnection, saveInstagramConnection } from "@/lib/db";
import type { InstagramDesk } from "@/lib/types";
import { safeEqual } from "@/lib/session";

const GRAPH = "https://graph.facebook.com/v22.0";

export const STATE_COOKIE = "instabot_ig_state";

const SCOPES = [
  "instagram_basic",
  "instagram_content_publish",
  "pages_show_list",
  "pages_read_engagement",
] as const;

const NOTICES: Record<string, string> = {
  denied: "Facebook Login was cancelled.",
  state: "That login attempt expired. Use Connect Instagram again.",
  exchange:
    "Facebook did not return an access token. Check META_APP_ID, META_APP_SECRET, and the redirect URL.",
  no_account:
    "No professional Instagram account is linked to a Facebook Page on this login. Use a Creator or Business account connected to a Page.",
};

export function stateCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function missingMetaEnv() {
  const missing: string[] = [];
  if (!process.env.META_APP_ID?.trim()) missing.push("META_APP_ID");
  if (!process.env.META_APP_SECRET?.trim()) missing.push("META_APP_SECRET");
  if (!process.env.META_REDIRECT_URI?.trim()) missing.push("META_REDIRECT_URI");
  return missing;
}

export function missingMetaMessage(missing: string[]) {
  const names = missing.map((name) =>
    name === "META_REDIRECT_URI" ? "META_REDIRECT_URI (the redirect URL)" : name,
  );
  const list =
    names.length <= 1
      ? (names[0] ?? "META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI (the redirect URL)")
      : names.length === 2
        ? `${names[0]} and ${names[1]}`
        : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
  return `Facebook Login needs ${list}. Connect Instagram stays here until ${names.length === 1 ? "it is" : "those are"} set.`;
}

export async function instagramDesk(): Promise<InstagramDesk> {
  const stored = await getInstagramConnection();
  const hasStored = Boolean(stored?.access_token && stored.ig_user_id);
  const hasEnv = Boolean(process.env.IG_ACCESS_TOKEN && process.env.IG_USER_ID);
  const missing = missingMetaEnv();
  return {
    connected: hasStored || hasEnv,
    username: stored?.username ?? null,
    stored: hasStored,
    setupHint: hasStored || hasEnv || missing.length === 0 ? null : missingMetaMessage(missing),
  };
}

export function instagramCallbackNotice(code: string | undefined) {
  if (!code) return null;
  return NOTICES[code] ?? null;
}

export function facebookLoginUrl(state: string) {
  const url = new URL("https://www.facebook.com/v22.0/dialog/oauth");
  url.searchParams.set("client_id", process.env.META_APP_ID?.trim() ?? "");
  url.searchParams.set("redirect_uri", process.env.META_REDIRECT_URI?.trim() ?? "");
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(","));
  return url;
}

export function oauthStateMatches(expected: string, got: string) {
  return Boolean(expected) && safeEqual(expected, got);
}

type ProfessionalAccount = {
  igUserId: string;
  token: string;
  username: string | null;
};

export function pickProfessionalAccount(body: unknown, userToken: string): ProfessionalAccount | null {
  if (!body || typeof body !== "object" || !("data" in body)) return null;
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const page = row as {
      access_token?: unknown;
      instagram_business_account?: { id?: unknown; username?: unknown };
    };
    const ig = page.instagram_business_account;
    const igUserId = typeof ig?.id === "string" ? ig.id : "";
    if (!/^\d+$/.test(igUserId)) continue;
    const pageToken = typeof page.access_token === "string" ? page.access_token.trim() : "";
    const token = usableToken(pageToken) ?? usableToken(userToken);
    if (!token) continue;
    const username =
      typeof ig?.username === "string" && /^[A-Za-z0-9._]{1,30}$/.test(ig.username) ? ig.username : null;
    return { igUserId, token, username };
  }
  return null;
}

function usableToken(value: string) {
  const token = value.trim();
  if (!token || token.length > 4096 || /\s/.test(token)) return null;
  return token;
}

function tokenFrom(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const value = (body as { access_token?: unknown }).access_token;
  if (typeof value !== "string") return null;
  return usableToken(value);
}

async function readGraph(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

async function postForm(body: URLSearchParams) {
  const response = await fetch(`${GRAPH}/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = await readGraph(response);
  if (!response.ok) return null;
  return tokenFrom(json);
}

async function findProfessionalAccount(userToken: string): Promise<ProfessionalAccount | "exchange" | "no_account"> {
  let after = "";
  for (let page = 0; page < 4; page += 1) {
    const url = new URL(`${GRAPH}/me/accounts`);
    url.searchParams.set("fields", "access_token,instagram_business_account{id,username}");
    url.searchParams.set("limit", "25");
    if (after) url.searchParams.set("after", after);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${userToken}` },
      cache: "no-store",
    });
    const body = await readGraph(response);
    if (!response.ok) return "exchange";
    const picked = pickProfessionalAccount(body, userToken);
    if (picked) return picked;
    const cursor = (body as { paging?: { cursors?: { after?: unknown } } }).paging?.cursors?.after;
    if (typeof cursor !== "string" || !cursor || cursor === after) return "no_account";
    after = cursor;
  }
  return "no_account";
}

export async function completeInstagramLogin(code: string): Promise<"ok" | "exchange" | "no_account"> {
  const appId = process.env.META_APP_ID?.trim() ?? "";
  const secret = process.env.META_APP_SECRET?.trim() ?? "";
  const redirectUri = process.env.META_REDIRECT_URI?.trim() ?? "";
  if (!appId || !secret || !redirectUri || !code.trim()) return "exchange";
  try {
    const shortLived = await postForm(
      new URLSearchParams({
        client_id: appId,
        client_secret: secret,
        redirect_uri: redirectUri,
        code: code.trim(),
      }),
    );
    if (!shortLived) return "exchange";
    const longLived = await postForm(
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: secret,
        fb_exchange_token: shortLived,
      }),
    );
    const userToken = longLived ?? shortLived;
    const account = await findProfessionalAccount(userToken);
    if (account === "exchange" || account === "no_account") return account;
    await saveInstagramConnection({
      accessToken: account.token,
      igUserId: account.igUserId,
      username: account.username,
    });
    return "ok";
  } catch {
    return "exchange";
  }
}

export async function disconnectInstagram() {
  await clearInstagramConnection();
}
