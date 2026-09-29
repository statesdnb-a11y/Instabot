# Instabot

A personal Instagram Reels desk. You only approve. The app picks a two-person still, fills a line from your caption templates, and cuts a short silent vertical reel. Instagram attaches a track from its licensed catalog when a send slot fires.

## Run it

You need Node.js and `ffmpeg` on your PATH (`libx264`).

```bash
npm install
npm run dev
```

The desk listens on [http://127.0.0.1:43123](http://127.0.0.1:43123) (`0.0.0.0:43123`).

The first launch fills five drafts and renders them one at a time. A 10 second 1080×1920 cut usually takes a few seconds. While a card says “Cutting this reel…”, leave the tab open.

Copy `.env.example` to `.env.local` if you want a passphrase or Instagram publishing. With nothing set, the desk is open, the reels stay silent, and approving does not try to post.

## What a reel is

- 1080×1920, H.264, no audio track, about 8–12 seconds, 30 fps
- Center-weighted 9:16 crop, then a slow zoom (1.0 → 1.08) or a slow pan that stays near the middle
- One sentence burned in over a soft scrim
- The same sentence stored as the Instagram caption, unless you split them
- Music is not mixed into the file. On publish, Instagram attaches a catalog track

Editing the on-screen line or regenerating the motion marks the cut stale and renders again. Swapping the catalog track does not re-render. Approve stays disabled until the latest line and motion are in the file.

## The desk

- **Drafts** — preview, edit the line, optionally a separate caption, new line, new motion, swap the catalog track, approve, or skip.
- **Approved** — reels waiting in approval order. One sends every 8 hours. The list shows the next send time. A failure stays here with the error and retries on the next slot. There is no posted archive.

Each draft shows the chosen track’s title, artist, and artwork once a catalog result is attached. Search and trending come from the official Audio API. Without credentials the card says music attaches after Facebook Login.

**Generate** tops the draft queue up to 5, or adds one more if it is already full. The server also refills after approve and skip, and on startup.

The queue lives in `data/instabot.db` (SQLite). Rendered mp4s live in `data/renders/` and are not committed. Stills in `data/photos` are.

Lines are filled from caption templates on the desk. Tokens are `{noun}`, `{adjective}`, `{him/her}`, `{he/she}`, and `{his/her}`. The noun and adjective banks are edited there too. **New line** and new drafts use that system, and they skip a caption that was already published, is on Approved, or is already on another draft. Saving a custom line keeps that exact line on the reel, files a template, and marks the card **Used before** when that caption collides. Approving remembers the final caption even after the reel is deleted. Pronouns in a typed line become `{he/she}`, `{him/her}`, or `{his/her}`, and a part-of-speech tagger turns nouns and adjectives into blanks and bank words. Click a noun or adjective blank to flip it. Seeded templates are not re-analyzed.

## Environment

| Variable | Required | What it does |
| --- | --- | --- |
| `INSTABOT_PASSWORD` | No | Locks the portal. Unset means open. |
| `IG_ACCESS_TOKEN` | No | Facebook Login token for the Instagram API. |
| `IG_USER_ID` | No | Instagram professional account id. |
| `UNSPLASH_ACCESS_KEY` | No | Unused in this version. Stills are bundled. |
| `PEXELS_API_KEY` | No | Unused in this version. Stills are bundled. |

## Stills

Photos are Unsplash License images of two people. Each reel stores the photo id, author, and source page. Credits also live in `src/lib/photos.ts`.

## Music

The local file stays silent. Music comes from Instagram’s official licensed catalog and is attached at publish time. The desk does not download, store, trim, or burn that audio into the mp4.

Search is `GET https://graph.facebook.com/v22.0/ig_audio?audio_type=music&user_id={ig-user-id}`. Omit `search_query` for trending; the portal search box sends it. On publish, `POST /{ig-user-id}/media` includes `media_type=REELS` and `audio_configuration={"audio_id":"...","audio_volume":100,"video_volume":0}`.

A browser `<audio>` element may play the temporary preview URL. That URL is not saved as a file and is not muxed into the reel. Meta does not support previewing the published reel with the attached audio.

Without `IG_ACCESS_TOKEN` and `IG_USER_ID`, the queue still works, the reel stays silent, and the UI says music attaches once the professional account is connected.

## Posting to Instagram

Approve only moves the reel onto the Approved list. It does not create an Instagram media container. Containers expire in about 24 hours, so one is opened only when a send slot fires.

Approved reels wait in approval order. The desk publishes one every 8 hours and shows the next send time on that list. When the slot fires it uploads the local silent mp4, sets `audio_configuration` to the chosen `audio_id` (or the first trending track if none was picked) with `video_volume` 0, then calls `media_publish` with `creation_id` only. That call publishes when it is made. It does not take `scheduled_publish_time`, and this desk does not use Facebook Page video scheduling.

When Meta returns a published media id, the reel is deleted. A failed send stays on Approved with the error and is retried on the next slot. If Instagram is not connected, the slot is skipped, the reel stays, and the silent mp4 remains downloadable. Nothing is saved as a posted history.

### Professional account setup

1. Switch the Instagram account to Professional (Business or Creator) and connect it to a Facebook Page you manage.
2. Create a Business app at [developers.facebook.com](https://developers.facebook.com/).
3. Use Instagram API with Facebook Login. Grant `instagram_basic` and `instagram_content_publish`, and link the Facebook Page.
4. Create a long-lived user token that includes those permissions.
5. Find the Instagram user id: `GET /me/accounts`, then `GET /{page-id}?fields=instagram_business_account`.
6. Put the token in `IG_ACCESS_TOKEN` and that id in `IG_USER_ID`.
7. The app needs to be in Live mode, or the Instagram account needs a role on the app, or publish calls are rejected.
8. Restart the dev server. Trending and search fill the track picker. Approving posts the silent file and asks Instagram to attach the chosen track.

The video is uploaded from the local file. A public video URL is not required. Docs: [Audio API](https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api).
