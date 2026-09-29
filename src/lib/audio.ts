import type { CatalogTrack } from "@/lib/types";

const GRAPH = "https://graph.facebook.com/v22.0";

export type AudioSearch =
  | { connected: false; tracks: [] }
  | { connected: true; tracks: CatalogTrack[]; error?: string };

function graphMessage(body: unknown) {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: { message?: string } }).error?.message;
    if (message) return message;
  }
  return "Instagram's music catalog could not be loaded.";
}

function asTrack(raw: unknown): CatalogTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = typeof row.audio_id === "string" ? row.audio_id : "";
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (!id || !title) return null;
  const artist = typeof row.display_artist === "string" ? row.display_artist : "";
  const artwork =
    typeof row.cover_artwork_thumbnail_uri === "string"
      ? row.cover_artwork_thumbnail_uri
      : typeof row.cover_artwork_thumbnail_url === "string"
        ? row.cover_artwork_thumbnail_url
        : null;
  const preview = typeof row.download_url === "string" ? row.download_url : null;
  const duration = typeof row.duration_in_ms === "number" ? row.duration_in_ms : null;
  return {
    id,
    title,
    artist,
    artworkUrl: artwork && artwork.startsWith("https://") ? artwork : null,
    previewUrl: preview && preview.startsWith("https://") ? preview : null,
    durationMs: duration,
  };
}

/**
 * Instagram Audio API (Facebook Login only).
 * Returns catalog metadata. The temporary preview URL is never downloaded or stored as a file.
 */
export async function searchMusic(query?: string): Promise<AudioSearch> {
  const token = process.env.IG_ACCESS_TOKEN;
  const userId = process.env.IG_USER_ID;
  if (!token || !userId) return { connected: false, tracks: [] };

  const url = new URL(`${GRAPH}/ig_audio`);
  url.searchParams.set("audio_type", "music");
  url.searchParams.set("user_id", userId);
  url.searchParams.set("access_token", token);
  const trimmed = query?.trim();
  if (trimmed) url.searchParams.set("search_query", trimmed);

  try {
    const response = await fetch(url, { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as { audio?: unknown };
    if (!response.ok) {
      return { connected: true, tracks: [], error: graphMessage(body) };
    }
    const tracks = Array.isArray(body.audio)
      ? body.audio.map(asTrack).filter((track): track is CatalogTrack => track !== null)
      : [];
    return { connected: true, tracks };
  } catch (error) {
    return {
      connected: true,
      tracks: [],
      error: error instanceof Error ? error.message : "Instagram's music catalog could not be loaded.",
    };
  }
}
