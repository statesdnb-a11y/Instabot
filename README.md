# Instabot

A personal Instagram Reels desk. You only approve. The app picks a two-person still, fills a line from your caption templates, and cuts a short vertical reel with Music 1, Music 2, or Music 3 mixed into the file.

## Run it locally

```bash
npm install
npm run dev
```

The desk listens on [http://127.0.0.1:43123](http://127.0.0.1:43123) (`0.0.0.0:43123`). Rendering uses the `ffmpeg-static` binary bundled with the app, and falls back to `ffmpeg` on your PATH. The on-screen type is the bundled Noto Serif Italic in `assets/`.

The first local launch fills five drafts and renders them one at a time in the background. Generate on this machine tops the queue back up to five and waits until each new file is written. A 10 second 1080×1920 cut usually takes a few seconds.

Copy `.env.example` to `.env.local` if you want a passphrase, Instagram publishing, or hosted storage. With nothing set, the desk is open and approving records the reel as not connected instead of posting. Connect Instagram stays at the top of the header. If `META_APP_ID`, `META_APP_SECRET`, or `META_REDIRECT_URI` is missing, the button stays there and names them.

## Hosted site

The same Next.js app is what runs on Vercel. Open the deployed URL, click Generate, edit a line, and approve on that site. Nothing has to stay running on a laptop.

Generate, New line, New motion, and a saved line edit render inside that request with `ffmpeg-static` and store the mp4 before the response returns. On Vercel each Generate click adds one reel so the render can finish inside a serverless function. Hobby functions stop at 60 seconds.

Local files do not survive a serverless instance. When `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are both set, the queue, caption banks, and used captions go to Turso. On Vercel, mp4s go to a public Vercel Blob store. Connect the store so the project gets `instabot_STORE_ID` or `BLOB_STORE_ID`; the app authenticates with OIDC and does not need `BLOB_READ_WRITE_TOKEN`. The store itself must be public, or the browser cannot play the file. Leave Blob unset locally and mp4s stay in `data/renders/`. SQLite stays in `data/instabot.db` when Turso is unset.

There is no in-process timer and no Vercel cron. Approve publishes immediately.

## What a reel is

- 1080×1920, H.264, no audio track, about 8–12 seconds, 30 fps
- Center-weighted 9:16 crop, then a slow zoom (1.0 → 1.08) or a slow pan that stays near the middle
- One sentence burned near the top: large white type with a dark stroke and shadow on the letters
- The same sentence stored as the Instagram caption, unless you split them
- Music is not mixed into the file. On publish, Instagram attaches a catalog track

Editing the on-screen line or regenerating the motion marks the cut stale and renders again. Swapping the catalog track does not re-render. Approve stays disabled until the latest line and motion are in the file.

## The desk

- **Drafts** — preview, edit the line, optionally a separate caption, new line, new motion, swap the catalog track, approve, or skip.
- **Approved** — a publish that did not return a media id. A failure stays here with the error. There is no posted archive.

Each draft shows the chosen track’s title, artist, and artwork once a catalog result is attached. Search and trending come from the official Audio API. Without credentials the card says music attaches after Facebook Login.

**Generate** tops the draft queue up to 5, or adds one more if it is already full. The server also refills after approve and skip, and on startup.

Locally the queue lives in `data/instabot.db` (SQLite) and rendered mp4s live in `data/renders/`. Those files are not committed. Stills in `data/photos` are. On Vercel the same rows live in Turso and the mp4s live in Vercel Blob when those credentials are set.

Lines are filled from caption templates on the desk. Tokens are `{noun}`, `{verb}`, `{him/her}`, `{he/she}`, and `{his/her}`. The noun and verb banks are edited there too. **New line** and new drafts use that system, and they skip a caption that was already published, is on Approved, or is already on another draft. Saving a custom line keeps that exact line on the reel, files a template, and marks the card **Used before** when that caption collides. Approving remembers the final caption even after the reel is deleted. Pronouns in a typed line become `{he/she}`, `{him/her}`, or `{his/her}`, and a part-of-speech tagger turns nouns and verbs into blanks and bank words. Click a noun or verb blank to flip it. Seeded templates are not re-analyzed.

## Environment

| Variable | Required | What it does |
| --- | --- | --- |
| `INSTABOT_PASSWORD` | No | Locks the portal. Unset means open. Connect Instagram stays behind this login. |
| `META_APP_ID` | To connect | Meta app id for the Connect Instagram button. |
| `META_APP_SECRET` | To connect | Meta app secret. Not stored in the database. |
| `META_REDIRECT_URI` | To connect | Redirect URL registered on the Meta app. Example: `https://your-desk.example/api/instagram/callback`. |
| `IG_ACCESS_TOKEN` | No | Optional fallback token when the desk has no stored login. |
| `IG_USER_ID` | No | Optional fallback Instagram professional account id. |
| `TURSO_DATABASE_URL` | For Vercel | libsql URL for the queue, banks, and used captions. |
| `TURSO_AUTH_TOKEN` | For Vercel | Turso token. Both Turso variables are required together. |
| `instabot_STORE_ID` or `BLOB_STORE_ID` | For Vercel | Public Blob store id. On Vercel the app uploads with OIDC. The preview plays the public Blob URL. |
| `BLOB_READ_WRITE_TOKEN` | Off Vercel only | Optional static token when OIDC is not available. Not required on Vercel. |
| `UNSPLASH_ACCESS_KEY` | No | Unused in this version. Stills are bundled. |
| `PEXELS_API_KEY` | No | Unused in this version. Stills are bundled. |

## Stills

New reels search Pexels at the moment you ask, instead of reshuffling a saved handful of files. Each search uses a slightly different white-studio query: candid couple white background, playful couple white seamless studio, couple full body white backdrop, two people white studio background, laughing couple high-key white studio, wedding couple white seamless backdrop, smiling couple plain white cyclorama, or affectionate couple white photography studio. A result is one photo per photographer, so the same couple does not fill the row. Scenic, outdoor, dark, and lifestyle-room photos are dropped. The stills are Pexels License images. Each reel stores the photo id, author, and source page. Set `PEXELS_API_KEY` to use the Pexels API; without it the desk reads the public search pages. Drafts already on the desk keep the still they were made with.

Creator is a button in the header. It opens the still picker. New stills runs another search. Pick a still and Music 1, Music 2, or Music 3. Generate a caption from the templates and word banks, or type one. Each generated line picks a template and words at random, and it will not repeat the line already in the box. Duplicate templates and bank words are removed when the caption list opens. The text in the box is burned into the reel, which lands in Drafts. Existing drafts and approved reels are left as they are.

## Music

Music 1, Music 2, and Music 3 live in `assets/music`. Each new reel picks one at random and mixes it into the mp4, looped or trimmed to the reel length. On startup the desk does the same for drafts and approved reels that do not have a track yet, including files already stored in Blob, so play on the live desk hears that audio. Publish uploads the file’s own audio. It does not send a catalog `audio_id` and does not set `video_volume` to 0 for those reels.

Search is `GET https://graph.facebook.com/v22.0/ig_audio?audio_type=music&user_id={ig-user-id}`. Omit `search_query` for trending; the portal search box sends it. On publish, `POST /{ig-user-id}/media` includes `media_type=REELS` and `audio_configuration={"audio_id":"...","audio_volume":100,"video_volume":0}`.

A browser `<audio>` element may play the temporary preview URL. That URL is not saved as a file and is not muxed into the reel. Meta does not support previewing the published reel with the attached audio.

Without a stored login or both `IG_ACCESS_TOKEN` and `IG_USER_ID`, the queue still works and approving does not post. The mp4 still has its Music 1, Music 2, or Music 3 track.

## Posting to Instagram

Approve publishes immediately. For a reel with Music 1, Music 2, or Music 3, it uploads that mp4 and does not send `audio_configuration`. The file’s audio is what Instagram keeps. A reel with no bed track still uses the catalog path: `audio_configuration` with `video_volume` 0. Then `media_publish` is called with `creation_id` only.

`media_publish` has no schedule time. This desk does not call Facebook Page `scheduled_publish_time`. That is a different product. There is no 8-hour timer and no cron.

When Meta returns a published media id, the reel is deleted. A failed publish stays on Approved with the error. Try posting again from that card. If Instagram is not connected, the reel stays on Approved with nothing posted, and the silent mp4 remains downloadable. Nothing is saved as a posted history.

### Professional account setup

1. Switch the Instagram account to Professional (Business or Creator) and connect it to a Facebook Page you manage.
2. Create a Business app at [developers.facebook.com](https://developers.facebook.com/) and add Facebook Login.
3. Set `META_APP_ID`, `META_APP_SECRET`, and `META_REDIRECT_URI` on the host. The redirect URL is the desk origin plus `/api/instagram/callback`, and it must match the Meta app exactly.
4. If any of those three are unset, the header still shows Connect Instagram and names the missing ones. It does not start login.
5. Open the desk (the portal passphrase, when set, stays in front of this) and click Connect Instagram. Facebook Login asks for `instagram_basic`, `instagram_content_publish`, `pages_show_list`, and `pages_read_engagement`.
6. The callback exchanges the code, finds the Page linked to the professional account, and stores that access token and Instagram user id in Turso or local SQLite. They are not written to a file or to git.
7. The app needs to be in Live mode, or the Instagram account needs a role on the app, or publish calls are rejected.
8. `IG_ACCESS_TOKEN` and `IG_USER_ID` still work as a fallback when nothing is stored. A stored login is what publish and catalog search use first.
9. Trending and search fill the track picker. Approving posts the silent file and asks Instagram to attach the chosen track.

The video bytes are uploaded from the stored mp4, whether that file is on disk or in Vercel Blob. A public video URL is not required for the Graph upload. Docs: [Audio API](https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api).
