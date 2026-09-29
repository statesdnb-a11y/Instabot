export const AUTH_COOKIE = "instabot_auth";

export function passwordRequired() {
  return Boolean(process.env.INSTABOT_PASSWORD);
}

export async function sessionToken(password: string) {
  const data = new TextEncoder().encode(`instabot.v1:${password}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
