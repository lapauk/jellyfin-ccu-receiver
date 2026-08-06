# Static-profile Chromecast Ultra receiver — deployment runbook

This fork of `jellyfin-chromecast` ships a **static device profile** for the
Chromecast Ultra instead of probing `canDisplayType()` at runtime. The CCU's
firmware is frozen, so its capabilities are a known constant; hardcoding them
is deterministic.

What the static profile allows (vs. the upstream receiver):

| Item | Upstream (stable) | This receiver |
|---|---|---|
| HEVC Main10 HDR10 4K | transcodes (level/range bug) | **direct play** |
| AC3 / EAC3 5.1 | audio transcode (hardcoded off) | **direct play** |
| H.264 ≤ 1080p | direct play | direct play |
| VP9 Profile 0/2 4K | direct play | direct play |
| AAC | ≤ 2ch | ≤ 2ch (device can't do AAC 5.1) |
| DTS / TrueHD / DV / AV1 | transcode | transcode (CCU can't decode) |
| MKV container | remux → MP4 (stream copy) | remux → MP4 (stream copy) |

## Files changed

- `src/components/staticCcuProfile.ts` — the static profile (new)
- `src/components/deviceprofileBuilder.ts` — dynamic builder (removed)
- `src/components/playbackManager.ts`, `src/components/maincontroller.ts` — import the static builder
- `.github/workflows/pages.yaml` — GitHub Pages pipeline (new)

Build locally: `npm ci && npm run build` → output in `dist/` (already verified:
typecheck, tests, and `dist/assets/index-*.js` contains the static profile and
zero `canDisplayType` calls).

---

## Step 1 — Push to GitHub and enable Pages

1. Create an empty repo, e.g. `jellyfin-ccu-receiver` (public or private — the
   *built site* must be public; source can be private).
2. Push this folder: `git remote add origin git@github.com:<you>/jellyfin-ccu-receiver.git && git push -u origin master`
3. In the repo: **Settings → Pages → Source: "GitHub Actions"**.
4. The `Deploy to GitHub Pages` workflow builds `dist/` and publishes it.
   Note your site URL: `https://<you>.github.io/jellyfin-ccu-receiver/`.

## Step 2 — Register a Google Cast application

1. Open the Google Cast SDK Developer Console (Google Cloud Console →
   APIs & Services → Google Cast SDK, or the Cast console linked from
   https://developers.google.com/cast/docs/registration).
2. **Create a Cast application**:
   - Name: `Jellyfin CCU (static)`
   - **Receiver application URL**: `https://<you>.github.io/jellyfin-ccu-receiver/`
   - Content type: video, if asked.
3. After creation Google issues an **App ID** (8 hex chars, like `F007D354`).
4. Availability: set to **Public**, or add your CCU as a developer/test device
   so the app launches on it. You can switch this later during testing.
5. Copy the App ID — you need it in step 3.

Notes:
- The receiver URL **must be HTTPS** with a valid cert (GitHub Pages is fine).
  Self-hosted LAN URLs won't work unless publicly reachable over HTTPS.
- A Cast app ID is only "attached" to a device once the app actually launches
  on it; if you change the URL you must relaunch.

## Step 3 — Point Jellyfin at the custom receiver (admin API, no SSH)

Create an API key if you don't have one: **Dashboard → Advanced → API Keys**.

Then, with `SERVER=http://<jellyfin-host>:8096` and `TOKEN=<api-key>`:

1. Add the app to the server's receiver list (this makes it appear in the
   client's "Google Cast version" dropdown):

   ```sh
   # fetch current system config
   curl -s -H "X-Emby-Token: $TOKEN" "$SERVER/System/Configuration" > sys.json
   # inject the new receiver (edit sys.json or use jq)
   jq --arg id "<APP_ID>" '.CastReceiverApplications += [{"Id": $id, "Name": "Chromecast Ultra (static)"}]' sys.json > sys.new.json
   # write it back (POST replaces the whole config)
   curl -s -X POST -H "X-Emby-Token: $TOKEN" -H "Content-Type: application/json" \
        -d @sys.new.json "$SERVER/System/Configuration"
   ```

2. Set the receiver on your user so casting uses it immediately:

   ```sh
   USER_ID=<your-jellyfin-user-id>   # Dashboard → the user's profile shows the id in the URL
   curl -s -H "X-Emby-Token: $TOKEN" "$SERVER/Users/$USER_ID/Configuration" > user.json
   jq --arg id "<APP_ID>" '.CastReceiverId = $id' user.json > user.new.json
   curl -s -X POST -H "X-Emby-Token: $TOKEN" -H "Content-Type: application/json" \
        -d @user.new.json "$SERVER/Users/$USER_ID/Configuration"
   ```

3. In the client (web or Android app): **Profile → Playback → Advanced →
   Google Cast version → "Chromecast Ultra (static)"**. Log out/in if the
   dropdown still shows the old value.

## Step 4 — Test

1. Cast an HEVC Main10 HDR10 MKV (or AC3/EAC3 audio) to the CCU.
2. Confirm direct play:
   - Dashboard → Active sessions: no "Transcoding" badge on the session.
   - Or open the item's Playback Info (ellipsis → Media info → Playback info):
     Play method `DirectPlay`.
   - Server log: no `hevc`→`h264` ffmpeg invocation; an MKV will show a
     *remux* to MP4 (stream copy) which is expected and cheap.

If something still transcodes, note the ffmpeg command in the log — it states
exactly which condition (video codec, profile, level, bitrate, audio codec,
subtitle) triggered it, and the condition lives in `staticCcuProfile.ts`.

## Rebuilding after changes

Push to `master` → Pages rebuilds and re-deploys automatically. The CCU picks
up the new receiver on its next launch (stop/start a cast session).
