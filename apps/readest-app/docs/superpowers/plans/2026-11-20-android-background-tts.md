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
  end event; live speak of unqueued mark invokes; handover stop keeps the map
  on Android (next live speak attaches) and clears it on iOS; real stop
  clears the map. Update the 2 existing stop tests (invoke now carries
  {payload:{handover:false}}).
- RED in CI, then GREEN. Watch both shards.

### B. Rust — StopArgs plumbing
- models.rs: StopArgs {handover: bool}; commands.rs stop(payload: StopArgs);
  mobile.rs stop forwards it; desktop.rs stub takes it (unused). lib.rs
  trait if it declares stop. No behaviour change elsewhere.

### C. Kotlin service — MediaPlaybackService.kt (live engine + list)
- Live engine on applicationContext (cold pattern: SPOKEN_MEDIA_ATTRIBUTES,
  onDone chaining, generation guard) + ArrayDeque<LiveSegment(utteranceId,
  text)> + liveCurrent/livePaused. Companion entry points (in-process, never
  startService): enqueueLive, speakLiveNow (flush list + speak), stopLive
  (handover: cut current only, keep list; else clear list + stop), pauseLive,
  resumeLive (re-speak current), setLiveRate/Pitch/Voice, ensureLiveTts,
  getLiveVoices. Listener emits tts_events via the plugin trigger
  (boundary on start, end on done, error on error) + advances the list.
- SessionCallback onPlay/onPause + focus/noisy handlers: live branches
  mirroring cold (pauseLive/resumeLive directly; still relay to JS so JS
  state stays in sync).
- Tests: extend the android/src/test setup if the harness runs them (check
  the APK workflow for a test step); at minimum a queue-state unit test in
  the style of MediaSessionActivationStateTest.

### D. Kotlin plugin — NativeTTSPlugin.kt (route to service)
- init/speak/stop/pause/resume/set_rate/set_pitch/set_voice/get_all_voices
  route to the service live engine. Remove the Activity TextToSpeech engine,
  its listener, and the 30-min idle timer (replaced by the service engine).
  Keep ExoPlayer playout, all media-session commands, destroy() minus the
  engine shutdown. stop parses the handover arg.

### E. PR + CI
- Push per task, draft PR early, verify RED then GREEN per task in CI
  (build_web_app + build_tauri_app; both shards at baseline).
- Kotlin compile-check: run the "Build test APK" workflow on the branch
  (build_tauri_app does not compile Android Kotlin). Check whether CI runs
  ./gradlew test; if not, Kotlin tests are documented as phone-verified only.

### F. Test APK + phone test (deciding check)
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
