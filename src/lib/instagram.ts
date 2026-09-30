import { getInstagramConnection } from "@/lib/db";

const GRAPH = "https://graph.facebook.com/v22.0";

export type PublishResult =
  | { state: "not_connected" }
  | { state: "posted"; igMediaId: string }
  | { state: "failed"; error: string };

export async function instagramCredentials() {
  const stored = await getInstagramConnection();
  if (stored?.access_token && stored.ig_user_id) {
    return { token: stored.access_token, userId: stored.ig_user_id };
  }
  const token = process.env.IG_ACCESS_TOKEN;
  const userId = process.env.IG_USER_ID;
  if (token && userId) return { token, userId };
  return null;
}

export async function instagramConnected() {
  return (await instagramCredentials()) !== null;
}

function graphError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body) {
    const message = (body as { error?: { message?: string } }).error?.message;
    if (message) return message;
  }
  return fallback;
}

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text.slice(0, 400) };
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Official Instagram Graph API Reels publish via resumable upload.
 * No-ops with not_connected when no stored login or env credentials exist.
 */
export async function publishReel(
  video: Buffer,
  caption: string,
  audioId: string | null,
  options?: { keepFileAudio?: boolean },
): Promise<PublishResult> {
  const creds = await instagramCredentials();
  if (!creds) return { state: "not_connected" };
  const { token, userId } = creds;
  const keepFileAudio = Boolean(options?.keepFileAudio);
  if (!keepFileAudio && !audioId) {
    return { state: "failed", error: "A catalog track is required before the container is created." };
  }

  const form = new URLSearchParams();
  form.set("media_type", "REELS");
  form.set("upload_type", "resumable");
  form.set("caption", caption);
  if (!keepFileAudio && audioId) {
    form.set(
      "audio_configuration",
      JSON.stringify({
        audio_id: audioId,
        audio_volume: 100,
        video_volume: 0,
      }),
    );
  }

  const initResponse = await fetch(`${GRAPH}/${userId}/media`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const initBody = await readJson(initResponse);
  if (!initResponse.ok) {
    return { state: "failed", error: graphError(initBody, "Instagram refused to open an upload.") };
  }

  const containerId = String((initBody as { id?: string }).id ?? "");
  const uri =
    (initBody as { uri?: string }).uri ||
    `https://rupload.facebook.com/ig-api-upload/v22.0/${containerId}`;
  if (!containerId) {
    return { state: "failed", error: "Instagram did not return an upload id." };
  }

  const uploadResponse = await fetch(uri, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${token}`,
      offset: "0",
      file_size: String(video.length),
      "Content-Type": "application/octet-stream",
    },
    body: new Blob([new Uint8Array(video)]),
  });
  const uploadBody = await readJson(uploadResponse);
  if (!uploadResponse.ok) {
    return {
      state: "failed",
      error: graphError(uploadBody, "The resumable upload to rupload.facebook.com failed."),
    };
  }

  let finished = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const statusResponse = await fetch(
      `${GRAPH}/${containerId}?fields=status_code,status`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const statusBody = (await readJson(statusResponse)) as {
      status_code?: string;
      status?: unknown;
    };
    if (statusBody.status_code === "FINISHED") {
      finished = true;
      break;
    }
    if (statusBody.status_code === "ERROR" || statusBody.status_code === "EXPIRED") {
      return {
        state: "failed",
        error: graphError(statusBody.status, "Instagram could not process the reel."),
      };
    }
    await sleep(1500);
  }
  if (!finished) {
    return { state: "failed", error: "Instagram is still processing the upload. Try posting again." };
  }

  const publishResponse = await fetch(`${GRAPH}/${userId}/media_publish`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    // Publishes immediately. media_publish has no scheduled_publish_time.
    body: JSON.stringify({ creation_id: containerId }),
  });
  const publishBody = (await readJson(publishResponse)) as { id?: string };
  if (!publishResponse.ok || !publishBody.id) {
    return { state: "failed", error: graphError(publishBody, "Instagram did not publish the reel.") };
  }
  return { state: "posted", igMediaId: String(publishBody.id) };
}
