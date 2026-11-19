# Re-enable Edge TTS on web for background audio — design

> Short design, approved by Towfiqul 2026-11-19. The plan that implements
> it is `docs/superpowers/plans/2026-11-19-edge-tts-background-audio.md`.

## Intent and why

The reader's audio must keep playing when the reader leaves the tab or
goes to the home screen, like a music app. Today on the web app the
reader uses the phone's built-in speech voice (Google Device TTS), which
is not real audio: Android stops it the moment the tab leaves the
foreground.

## What exists today

- WebSpeechClient (`apps/readest-app/src/services/tts/WebSpeechClient.ts`)
  drives the current default voice through `window.speechSynthesis`. The
  code itself notes it is a "direct-speak engine: the OS renders the
  audio, so there is no media clock".
- Edge TTS (free Microsoft voices) already exists in the code and does
  everything this feature needs: real per-sentence audio
  (`EdgeTTSClient` + `BufferedTTSClient`), per-book audio cache,
  sentence highlighting, and lock-screen controls wired through
  `ttsMediaBridge` / `navigator.mediaSession`.
- Edge TTS was switched off in the fork (commit `193c0e0`, 2026-10-30)
  with no reason recorded — the controller comment only says "it did not
  work on the web app". The files were left on disk, unused.
- Edge reaches Microsoft two ways: direct `wss` from the browser (free,
  "intermittently blocked in browsers") and the `https` proxy route
  `POST /api/tts/edge` (requires Google sign-in; 403 otherwise). The
  sign-in wiring already exists: the controller is built with
  `!!user?.id`, and the `tts-need-auth` event already prompts for
  sign-in.

## Goals

- Playing audio keeps playing after the reader goes to the home screen,
  with lock-screen play/pause controls.
- Sentence highlighting keeps following the spoken sentence.
- Edge TTS voices appear in the voice picker; Edge is the default voice
  on web when it works; device TTS stays as the fallback.
- A signed-out reader who picks Edge gets the sign-in prompt, not a
  silent failure.

## Non-goals (what this is not)

- Not a new TTS engine or provider.
- Not opening `/api/tts/edge` to signed-out users (option B, declined).
- No changes to the Android app's TTS (native path untouched).
- Device TTS is not removed.

## Approaches considered

- **A (picked): re-enable Edge TTS on web and fix why it failed.**
  Smallest real fix; free voices; background playback via the existing
  audio + MediaSession path. Sign-in needed for the reliable (proxy) leg.
- **B (declined): same, but make the proxy work without sign-in.** The
  direct leg is sometimes blocked, so the proxy would have to serve
  everyone — anyone could use the site as a free TTS service, so it
  would need rate limits. More work, more risk.
- **C (dropped): keep device TTS and add a background keep-alive hack**
  (silent audio loop to hold audio focus). Unreliable; Chrome updates
  break it.

## Parts decided

- Approach A. Sign-in needed for the proxy leg (user's pick, 2026-11-19).
- Ships as its own PR, separate from PR #2 (round 2 fixes).
- Web build must be green to merge (the Tauri job skips when no Tauri
  files change, as PR #3 showed).

## Left to the builder

- Which Edge leg is actually broken on the live site (direct `wss`,
  proxy, or something else) — the plan starts with reproducing it
  before any fix is written.

## Diagnosis (2026-11-19, Task 1)

- Direct `wss` leg: BROKEN from this network. Throwaway probe
  (`edge-wss-probe.mjs`, Node global WebSocket, no custom headers like a
  browser, valid Sec-MS-GEC token): `FAIL: WebSocket error event`. A
  curl handshake with the full auth params
  (`ConnectionId`, `Ocp-Apim-Subscription-Key`, `Sec-MS-GEC`) returns
  `HTTP 403 Forbidden` from `api.msedgeservices.com` itself
  (X-CDN-TraceID present). Matches the known upstream pattern (code
  comment: the old endpoint 403s in many regions, rany2/edge-tts#490) —
  now also on the migrated endpoint from this network. Caveat: the
  sandbox's shared datacenter IP may differ from a phone on a Bangladeshi
  mobile network, so the 403 is what this network gets, not proof the
  phone would get the same.
- `https` proxy leg: NOT verified live. The route exists and enforces
  auth (unauthenticated GET returns `{"error":"Not authenticated"}`).
  Code path intact: the client sends `Authorization: Bearer <Supabase
  token>` via `fetchWithAuth`; the server validates it with
  `supabase.auth.getClaims` (role must be `authenticated`); the server
  then opens `wss` to Microsoft from the Vercel server with full
  headers. The cloud browser could not open DevTools to run the signed-in
  call, and the user is on his phone without a console — so the live
  proxy test moves to the Vercel preview check (Task 6), where signed-in
  playback settles it.
- Consequence: Task 2 (re-enable) proceeds as written. Task 3 is
  conditional on preview evidence: if the proxy works on the preview,
  Task 3 needs no code change; if it fails (Microsoft 403s Vercel's IPs
  too), Task 3 fixes the proxy leg.
