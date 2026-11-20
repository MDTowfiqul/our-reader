# Phone-test round 3 plan (2026-11-20, approved: "Build")

User's list, in his words. All on branch `android-background-tts` (PR #7).

## 1. Remove the Our Reader Voice section (Select Voice)
- The "Our Reader Voice" group is the Readest cloud-voice provider
  (`ttsReadestClient`), renamed by the rebrand fold. Remove it from the
  picker's voice list: `TTSController.getVoices` stops including the
  Readest client. Playback fallbacks are untouched; a stored Readest
  preference falls back to the next client as today.
- NOT removed: the Readest client itself, the Edge catalog, system voices.

## 2. Voice picker: Offline / Online, by language, all languages, pins
- Top level: **Offline** (voices that work without internet) then
  **Online** (voices that need internet). Grouping is by capability
  (house rule: gate on `TTSCapabilities`, never on client identity):
  native/system + web-speech + media-overlay = Offline; Edge + custom =
  Online.
- Inside each section, voices grouped by language (collapsible rows,
  as today). Language name shown next to every voice (F5a kept).
- All languages: the picker calls a new `TTSController.getAllVoices()`
  once instead of per-language `onGetVoices([book, en, ar])` — Edge
  contributes every locale in `EDGE_TTS_VOICES`, native contributes
  every voice from `getAllVoices()` (no per-language filter).
- Pins: a pin toggle on each language row and each voice row; pinned
  languages and pinned voices appear in a **Pinned** section at the top.
  Pins persist in localStorage (`ttsPinnedVoices` / `ttsPinnedLangs`
  keys — decide exact keys in implementation, keep one store).
- Tests: update `TTSPlayerSheet.test.tsx` (fetch shape, groups,
  pin behaviour), `native-tts-client.test.ts` (getAllVoices use),
  any test that expects the Readest group in the picker.

## 3. TTS settings: device voices + settings button
- Finding: the panel calls the exact same `get_all_voices` invoke the
  picker uses, and the Kotlin side waits up to 2s for engine readiness.
  On the phone it still shows "No device voices found". Fix: retry the
  invoke (a few attempts while the engine warms up) and add a visible
  reload affordance on Tauri instead of silently showing the empty
  note. The install-voice-data text stays only for the web path.
- "Open phone TTS settings" navigates the WebView to an `intent:` URL
  and lands on a "Web page not available" error. Fix: a new native
  plugin command that fires `Settings.ACTION_TTS_SETTINGS` from Kotlin
  (new `open_tts_settings` command on the native-tts plugin), called
  from the panel via invoke. No more `window.location.href = 'intent:…'`.
- Tests: extend `DeviceTTSSettings.test.tsx` (retry path, reload
  button); the Kotlin command has no unit test (APK workflow has no
  gradle test step — same recorded decision as PR #7).

## 4. Share Book without sign-in
- Finding: the reader's Share Book opens `ShareBookDialog`, which
  creates a remote share link via Readest cloud (`createShare`) — hence
  the sign-in gate in `ReaderContent.handleShareIntent`. The app
  already has an OS share-sheet path (`shareFile` from
  `@choochmeque/tauri-plugin-sharekit-api`, used by
  `nativeAppService` share + `backupService`).
- Fix: when the book file is on the device, Share Book sends the file
  through the OS share sheet (WhatsApp, Gmail, Drive…), no account.
  Cloud-only books download first via the existing download path.
  The cloud share dialog stays for users who explicitly want a link
  (out of scope to remove; the menu item becomes file share).
- Tests: update the ReaderContent/Bookshelf share tests that expect
  the sign-in toast; add a test for the file-share path.

## 5. Default speed 1.0
- `src/services/constants.ts:534` `ttsRate: 1.3` → `1.0`. Same for the
  `?? 1.3` fallback in `DeviceTTSSettings.tsx:57` (and any other
  `1.3` default found by grep). `TTSController` already defaults 1.0.
- No stored-rate reset: books that never saved a speed pick up the new
  default automatically.

## 6. Chat about book page → WhatsApp-like
- `BookChat.tsx` + `ChatHistoryView.tsx`: messages as bubbles (user
  right, answers left), input box pinned at the bottom with Send,
  history kept. Look only — the AI answers and the chat storage do
  not change.

## 7. AI sheet → modern chat like WhatsApp/Messenger
- Same bubble + bottom-input treatment for the AI bottom sheet
  (ask + Summarise views). Look only — no change to what the AI
  answers or to the Summarise function.

## Order
5 (trivial) → 1 → 3 (settings + Kotlin) → 4 (share) → 2 (picker,
biggest) → 6+7 (chat UI) → push → CI → APK → deliver.

## Verification
- Test-first per item; Biome 2.4.15 format+lint; esbuild syntax.
- CI: build_web_app SUCCESS; shards at the 164/56 baseline (minus
  fixed, plus none new). Tauri desktop job stays red on the
  pre-existing unused-deps warnings (out of scope).
- APK run must succeed; deliver the release APK with a test list.

## Status — 2026-11-20 ~18:15 +06
- Batches 1–3 implemented + committed locally (000b016, 9947061, af2aa19):
  1. default speed 1.0; Our Reader Voice section removed from picker;
     device-voices retry + reload; TTS settings button via native command;
     Share Book via OS share sheet (no sign-in).
  2. picker Offline/Online by language, all Edge + all system languages,
     pin system for favourite language and voice.
  3. WhatsApp-style chat: BookChat bubbles (user right, answers left)
     + round send button + pinned composer + auto-scroll; ChatHistoryView
     avatars + rename/delete always visible on touch; summary as AI bubble.
- No tests exist for BookChat / ChatHistoryView / SummaryPanel (look-only
  restyle); verification is CI build + phone test.
- Pushed to android-background-tts; CI watch + APK rebuild next.
