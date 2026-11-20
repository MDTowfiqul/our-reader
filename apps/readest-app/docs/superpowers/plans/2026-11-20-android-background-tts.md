# Plan — Android app background TTS (branch android-background-tts, off main a686317)

## Shape (from design.md)
The service owns a live TTS engine + a native sentence list (cold-path pattern);
the TS client really preloads (queue ahead, attach on live speak); the plugin
routes TTS commands to the service. No new engine, no cloud, no UI, no iOS
code changes, no web changes. Separate PR from PR #6.

## Key mechanics (settled during investigation)
- Controller feeds ahead as today: #speak preloads the current paragraph
  first (line 1962), then live-speaks it; preloadNextSSML feeds 4 more
  (windowedPrefetch -> 40 paragraphs / 180s). With the dummy removed, those
  preloads actually queue sentences natively.
- Dedupe lives in the TS client: a queued-marks map (mark.name -> utteranceId).
  Preload of an already-queued mark is a no-op; live speak of a queued mark
  attaches to its utterance events (no second invoke); live speak of an
  unqueued mark invokes speak (flush + fresh). Preload generators return
  immediately after enqueueing (never await speech) — preloadSSML drains them.
- Handover stop must NOT flush the queue (auto-advance would cut the next
  paragraph's first sentence and re-queue every boundary). Client
  stop(handover=true): Android keeps the map, invokes plugin stop with
  {handover:true}; the service cuts only the current utterance, keeps the
  list. iOS stop flushes the synthesizer queue, so the client clears the map
  on iOS handover (same invoke; iOS ignores the arg). Real stop (!handover)
  clears everything on both.
- Lock-screen/focus pause+play act on the live engine directly in the service
  (cold-pattern branches), because the JS relay is lost when the page is
  frozen (#5561). Skip/seek stay JS-relayed (known limitation, documented).

## Tasks
### A. TS client — NativeTTSClient.ts (test-first)
- speakMark: real preload (invoke speak {preload:true}, register utterance +
  map entry, yield nothing); live attach for queued marks; live invoke for
  unqueued marks. stop(handover) semantics above. getCapabilities:
  windowedPrefetch true (both platforms — iOS synthesizer queues too).
- Tests in native-tts-client.test.ts (harness mocks invoke + addPluginListener;
  pass a fake controller {appService:{isAndroidApp}} for Android cases):
  preload invokes + returns at once; second preload of same mark no-ops;
  live speak of queued mark attaches with no second invoke and yields its
  end event; live speak of unqueued mark invokes; handover stop is a no-op on
  Android (no stop invoke; next live speak attaches) and clears the map on
  iOS; real stop clears the map; fresh live speak of an unqueued mark flushes
  previously queued marks on Android (next live speak of one invokes fresh).
  The stop invoke keeps its no-arg form.
- Status 2026-11-20 ~11:30: implementation + 9 tests written locally (not
  yet pushed). Local gates pass (esbuild transpile, Biome format + lint).
  RED in CI, then GREEN. Watch both shards.

### B. Kotlin service — MediaPlaybackService.kt (live engine + list)
- Live engine on applicationContext (cold pattern: SPOKEN_MEDIA_ATTRIBUTES,
  onDone chaining, generation guard) + ArrayDeque<LiveSegment(utteranceId,
  text)> + liveCurrent/livePausedSegment. Companion entry points (in-process,
  never startService): ensureService, ensureLive, drainPendingLiveSegments,
  enqueueLive, speakLiveNow (flush list + speak), stopLive (clear-all, as
  today — handover is a client-side no-op, the service needs no flag),
  pauseLive, resumeLive (re-speak paused segment), setLiveRate/Pitch/Voice,
  getLiveVoices, isLiveTtsReady. Listener emits tts_events via the plugin
  trigger (boundary on start, end on done, error on error) + advances the
  list. Sentences enqueued before the service exists are held in
  pendingLiveSegments and drained in onCreate. clearLiveTtsPlayback() is
  called from deactivateSession() and onDestroy().
- SessionCallback onPlay/onPause + focus/noisy handlers: live branches
  mirroring cold (pauseLive/resumeLive directly; still relay to JS so JS
  state stays in sync).
- Status 2026-11-20 ~11:30: written locally (not yet pushed). Kotlin unit
  tests: NOT added — the android/src/test harness is not run by CI (to be
  confirmed from the APK workflow when it runs); the compile check is the
  "Build test APK" workflow and behaviour is phone-verified (Task E).

### C. Kotlin plugin — NativeTTSPlugin.kt (route to service)
- init/speak/stop/pause/resume/set_rate/set_pitch/set_voice/get_all_voices
  route to the service live engine. init starts the service and polls
  readiness up to 3 s; speak resolves immediately with a UUID and routes
  preload to enqueueLive, live to speakLiveNow; get_all_voices polls
  readiness up to 2 s and maps the service voices (same id/name logic as
  before); set_voice validates against the service voices first. Removed:
  the Activity TextToSpeech engine, its listener, the event-channel
  machinery, and the 30-min idle timer. resume stays a no-op (WebView resume
  re-speaks). Kept untouched: ExoPlayer playout, all media-session commands,
  destroy() minus the engine shutdown.
- Status 2026-11-20 ~11:30: written locally (not yet pushed). The earlier
  Rust StopArgs{handover} plumbing was written and fully reverted — all 4
  Rust files clean; the stop invoke keeps its no-arg form.

### D. PR + CI
- Push per task, draft PR early, verify RED then GREEN per task in CI
  (build_web_app + build_tauri_app; both shards at baseline).
- Kotlin compile-check: run the "Build test APK" workflow on the branch
  (build_tauri_app does not compile Android Kotlin). Check whether CI runs
  ./gradlew test; if not, Kotlin tests are documented as phone-verified only.
- Status: PR #7 draft open (head 2a461a98, tests only). RED run confirmed
  (build_web_app failure + both shards failure) — the build_web_app failure
  is undiagnosed; a browser task is reading its job log (run 44680040872,
  job 136100961636). Implementation push waits on that diagnosis.

### E. Test APK + phone test (deciding check)
- Release APK from the branch (fresh test keystore flow, as for v0.12.16),
  user tests on his phone: play, home screen (audio continues past 3 min),
  lock-screen pause/play, skip. A passing CI build is never the proof.

## Known limitations (record, do not silently fix)
- Lock-screen skip/seek still need live JS (#5561 pattern); only pause/play
  are fixed natively.
- If the WebView is destroyed (not just stopped), the session is over; the
  service keeps speaking its buffered queue, and a fresh Speak starts a new
  session.
- Utterance end events to a frozen WebView are delayed, not dropped (throttled
  renderer); on return the live loop fast-forwards through finished marks.
