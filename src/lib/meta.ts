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
    setupHint: missing.length === 0 ? null : missingMetaMessage(missing),
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

const PAGE_FIELDS =
  "id,access_token,instagram_business_account{id,username},connected_instagram_account{id,username}";
const PAGE_IG_FIELDS = "instagram_business_account{id,username},connected_instagram_account{id,username}";

type ProfessionalAccount = {
  igUserId: string;
  token: string;
  username: string | null;
};

type PageRecord = {
  id?: unknown;
  access_token?: unknown;
  instagram_business_account?: unknown;
  connected_instagram_account?: unknown;
};

function readIg(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const ig = value as { id?: unknown; username?: unknown };
  const igUserId = typeof ig.id === "string" ? ig.id : "";
  if (!/^\d+$/.test(igUserId)) return null;
  const username =
    typeof ig.username === "string" && /^[A-Za-z0-9._]{1,30}$/.test(ig.username) ? ig.username : null;
  return { igUserId, username };
}

function instagramOnRecord(record: unknown) {
  if (!record || typeof record !== "object") return null;
  const row = record as PageRecord;
  return readIg(row.instagram_business_account) ?? readIg(row.connected_instagram_account);
}

function accountFromRecord(record: PageRecord, userToken: string): ProfessionalAccount | null {
  const ig = instagramOnRecord(record);
  if (!ig) return null;
  const pageToken = typeof record.access_token === "string" ? record.access_token : "";
  const token = usableToken(pageToken) ?? usableToken(userToken);
  if (!token) return null;
  return { igUserId: ig.igUserId, token, username: ig.username };
}

function pageRows(body: unknown): PageRecord[] {
  if (!body || typeof body !== "object" || !("data" in body)) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is PageRecord => Boolean(row) && typeof row === "object");
}

function pickProfessionalAccount(body: unknown, userToken: string): ProfessionalAccount | null {
  for (const row of pageRows(body)) {
    const account = accountFromRecord(row, userToken);
    if (account) return account;
  }
  return null;
}

function instagramIdFromDebugToken(body: unknown) {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const scopes = (data as { granular_scopes?: unknown }).granular_scopes;
  if (!Array.isArray(scopes)) return null;
  for (const scopeName of ["instagram_basic", "instagram_content_publish"]) {
    for (const scope of scopes) {
      if (!scope || typeof scope !== "object") continue;
      if ((scope as { scope?: unknown }).scope !== scopeName) continue;
      const ids = (scope as { target_ids?: unknown }).target_ids;
      if (!Array.isArray(ids)) continue;
      for (const id of ids) {
        if (typeof id === "string" && /^\d+$/.test(id)) return id;
      }
    }
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

function quoteWideIntegers(text: string) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] ?? "";
    if (inString) {
      out += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char >= "0" && char <= "9") {
      let end = i;
      while (end < text.length && (text[end] ?? "") >= "0" && (text[end] ?? "") <= "9") end += 1;
      const digits = text.slice(i, end);
      const previous = out.trimEnd().at(-1);
      const structural = previous === ":" || previous === "[" || previous === ",";
      out += digits.length >= 16 && structural ? `"${digits}"` : digits;
      i = end - 1;
      continue;
    }
    out += char;
  }
  return out;
}

function parseGraphJson(text: string) {
  return JSON.parse(quoteWideIntegers(text)) as unknown;
}

async function readGraph(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return parseGraphJson(text);
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

async function graphGet(pathname: string, token: string, fields: string) {
  const url = new URL(`${GRAPH}/${pathname}`);
  url.searchParams.set("fields", fields);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return { ok: response.ok, body: await readGraph(response) };
}

async function findProfessionalAccount(
  userToken: string,
  appId: string,
  appSecret: string,
): Promise<ProfessionalAccount | "exchange" | "no_account"> {
  const pagesMissingIg: { id: string; token: string }[] = [];
  let after = "";
  for (let page = 0; page < 4; page += 1) {
    const url = new URL(`${GRAPH}/me/accounts`);
    url.searchParams.set("fields", PAGE_FIELDS);
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
    for (const row of pageRows(body)) {
      const id = typeof row.id === "string" && /^\d+$/.test(row.id) ? row.id : "";
      const token = typeof row.access_token === "string" ? usableToken(row.access_token) : null;
      if (!id || !token || instagramOnRecord(row)) continue;
      pagesMissingIg.push({ id, token });
    }
    const cursor = (body as { paging?: { cursors?: { after?: unknown } } }).paging?.cursors?.after;
    if (typeof cursor !== "string" || !cursor || cursor === after) break;
    after = cursor;
  }

  for (const page of pagesMissingIg) {
    const result = await graphGet(page.id, page.token, PAGE_IG_FIELDS);
    if (!result.ok || !result.body || typeof result.body !== "object") continue;
    const ig = instagramOnRecord(result.body);
    if (!ig) continue;
    return { igUserId: ig.igUserId, token: page.token, username: ig.username };
  }

  const igUserId = await grantedInstagramUserId(userToken, appId, appSecret);
  const token = usableToken(userToken);
  if (!igUserId || !token) return igUserId ? "exchange" : "no_account";
  return { igUserId, token, username: await instagramUsername(igUserId, token) };
}

async function grantedInstagramUserId(userToken: string, appId: string, appSecret: string) {
  const url = new URL(`${GRAPH}/debug_token`);
  url.searchParams.set("input_token", userToken);
  url.searchParams.set("access_token", `${appId}|${appSecret}`);
  const response = await fetch(url, { cache: "no-store" });
  const body = await readGraph(response);
  if (!response.ok) return null;
  return instagramIdFromDebugToken(body);
}

async function instagramUsername(igUserId: string, token: string) {
  const result = await graphGet(igUserId, token, "username");
  if (!result.ok) return null;
  return readIg({ id: igUserId, username: (result.body as { username?: unknown }).username })?.username ?? null;
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
    const account = await findProfessionalAccount(userToken, appId, secret);
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
