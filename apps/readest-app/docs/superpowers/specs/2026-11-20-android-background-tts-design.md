# Design — Android app background TTS (Anx-style)

## Goal (user's words)
"Just build the app" — the Android app's TTS keeps speaking when the app
goes to the home screen, like Anx Reader. Don't make it too complicated:
system voices only, no cloud, no UI redesign.

## What the investigation found (2026-11-20)
Most of Anx's shape is ALREADY in our app: foreground service
(MediaPlaybackService, mediaPlayback type), notification with prev/play/pause/
next, MediaSession + Android Auto, audio focus, a silent keep-alive tone in
the WebView. The service keeps the notification alive — but the SPEECH stops,
because:
1. Nothing is ever queued natively. The controller feeds 4 paragraphs ahead,
   but for the native client the preload path is a dummy
   (NativeTTSClient.ts:104-108 yields 'Dummy preload finished' and never
   sends the text). The plugin already maps preload -> QUEUE_ADD; the web
   side never uses it for real text.
2. The sentence pump lives in the WebView. Each sentence needs the JS loop
   alive (timers + per-sentence invoke). When the page stalls, speech ends
   after the current sentence. (Codebase's own #4408/#5561 comments say the
   same for lock-screen Play.)
3. The live engine is Activity-owned (`TextToSpeech(activity, …)`), not
   service-owned. The service's own engine (coldTts, application context)
   only speaks for the Android Auto cold-start path, never for a live session.

## Fix (minimal, three changes)
1. **MediaPlaybackService.kt** — a live TTS engine + native sentence queue
   in the service, reusing the cold path as the template: engine on
   `applicationContext`, segments chained on `onDone` (like
   `speakCurrentColdTtsSegment`), companion-object entry points for
   enqueue/stop/pause/rate/voice (same pattern as pushMetadata).
   This is the one structural change: the pump moves out of the WebView.
2. **NativeTTSPlugin.kt** — route speak/stop/pause/set_rate/set_pitch/
   set_voice to the service instead of the Activity-owned engine. Keep the
   ExoPlayer playout (Media Overlay/audiobook) and all media-session
   commands untouched. The Activity binding for TTS goes away.
3. **NativeTTSClient.ts** — make the preload path real: `speakMark(preload=true)`
   invokes `plugin:native-tts|speak` with `preload: true` (QUEUE_ADD)
   instead of yielding the dummy end. The controller's existing 4-paragraph
   feed-ahead then actually buffers sentences in the service.
4. **TTSController.ts** — no change expected (preloadNextSSML already feeds
   ahead for every engine).

## Open design decision (SETTLED during Task A)
With preloading real, the live loop must not re-issue sentences already
queued, or they double-speak. Settled: the dedupe lives in the TS client
(a queued-marks map, mark.name -> utteranceId). Preload of an already-queued
mark is a no-op; live speak of a queued mark attaches to its utterance
events; live speak of an unqueued mark invokes speak (flush + fresh).

Handover stop, also settled: the client's stop(handover=true) is a NO-OP on
Android — the service is already speaking the next paragraph's queued audio,
and cutting it would skip its first sentence. A user skip mid-sentence is
cut by the speak loop's abort handler (full stop), not by the handover path.
On iOS the synthesizer queue is flushed by a stop, so the client clears the
map there. No Rust change and no handover flag in the plugin: the plugin's
stop stays a clear-all, as today.

Fresh-invoke flush, settled during Task A: a live speak of an unqueued mark
flushes the service queue (speakLiveNow), so every still-queued mark is gone
with it. The client therefore clears the queued-marks map (and their
utterance entries) on Android before a fresh live invoke — otherwise a later
live speak would attach to a flushed utterance and wait forever. On iOS the
synthesizer queues instead of flushing, so queued marks stay valid there and
the map is kept.

## Non-goals
No new engine, no cloud TTS, no web changes, no UI redesign, no iOS changes.
PR #6 (web default guard) is a separate PR and stays separate.

## Verification
- Unit tests first (TS client preload; Kotlin service queue tests if the
  harness allows — check the existing android/src/test setup).
- CI: build_web_app + build_tauri_app green, test totals at baseline.
- Deciding check: the user's phone — a test APK, play, go to home screen,
  audio keeps playing + lock-screen controls work. A passing health check
  is never the proof; his phone is.
