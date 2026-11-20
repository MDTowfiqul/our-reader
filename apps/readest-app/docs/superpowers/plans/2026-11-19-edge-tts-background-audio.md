# Edge TTS background audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web reader's audio keeps playing after the reader leaves the tab or goes to the home screen, by re-enabling the existing Edge TTS real-audio engine.

**Architecture:** No new engine. Diagnose which Edge transport leg is broken on the live site (direct `wss` vs the signed-in `https` proxy), fix that leg, re-enable Edge probing/listing in `TTSController.init`, and prefer a real-audio (`mediaClock: true`) client as the web default, with device TTS as fallback.

**Tech Stack:** TypeScript, Next.js 16, Vitest + jsdom, Edge TTS (Microsoft), Web Audio API, MediaSession API.

**Spec:** `apps/readest-app/docs/superpowers/specs/2026-11-19-edge-tts-background-audio-design.md`

## Global Constraints

- Minimum code that solves the problem; no features beyond the spec; no abstractions for single-use code.
- Gate behaviour on `TTSCapabilities`, never on client identity (project rule, `AGENTS.md` Read Aloud section).
- Test-first: before changing code, read `LESSONS.md` and `.agents/rules/` (test-first, typescript, verification, acceptance).
- No new user-facing copy unless it follows `docs/i18n.md`; this change should need none (the "Edge TTS" label and the sign-in prompt already exist).
- No change to `/api/tts/edge` auth for signed-out users; no change to the Android app's TTS.
- Commits, PR title and description are public: never include user ids, emails, counts, or payment data.
- Ship as its own PR from branch `edge-tts-background-audio`, separate from PR #2; the web build must be green to merge.
- Work in this sandbox clone on branch `edge-tts-background-audio` (off `origin/main` `cc09e08`); there is no `node_modules` / pnpm install here, so run typecheck, lint and tests through the project's CI on the PR, and verify locally only where the sandbox allows.

## Review Focus

- A reader on mobile data whose network blocks the direct `wss` leg must fall back to device TTS without the player hanging on open — test in Task 2 pins the fallback when Edge init fails.
- A Google token that expired mid-session must surface the sign-in prompt, not a stuck spinner, when the proxy answers 403 — test in Task 5 pins the `tts-need-auth` path.
- An Edge init that hangs must not delay the player: the existing `withinEngineTimeout` bound must still apply to the Edge probe — test in Task 2 pins the timeout.
- Switching voices must not replay audio cached under another voice: the per-book cache key must include the voice id — test in Task 3 pins the cache key.
- Background playback must actually survive leaving the tab: MediaSession metadata must be set when real-audio playback starts — test in Task 6 pins metadata on play.

---

### Task 1: Diagnose which Edge leg is broken

**Files:**
- Modify: `apps/readest-app/docs/superpowers/specs/2026-11-19-edge-tts-background-audio-design.md` (append a "Diagnosis" section with the findings)
- Test: none (diagnosis only; no product code)

**Interfaces:**
- Consumes: `apps/readest-app/src/libs/edgeTTS.ts` (the `wss` handshake and the `https` proxy transport), `apps/readest-app/src/services/tts/providers/edge.ts` (`EdgeSpeechProvider.init`), `apps/readest-app/src/app/api/tts/edge/route.ts` (proxy auth: `validateUserAndToken`, 403 without a token)
- Produces: the failing leg's name and exact error, recorded in the design doc, which Task 3 fixes

- [ ] **Step 1: Probe the direct `wss` leg from the sandbox**

Write a throwaway Node script (not committed) that opens the Edge `wss` endpoint exactly as `EdgeSpeechTTS` does in `src/libs/edgeTTS.ts` (same URL, headers, SSML payload, `en-US-AriaNeural`, rate 1.0) and reports whether audio bytes arrive. Run it with the sandbox Node (v24, global `WebSocket`).

Expected: a clear pass/fail plus the exact error or close code on failure.

- [ ] **Step 2: Read the `https` proxy leg and its auth path**

Read `src/libs/edgeTTS.ts` (`https` transport: how it calls `/api/tts/edge` and which `Authorization` header it sends), `src/app/api/tts/edge/route.ts` (`validateUserAndToken`), and `src/services/tts/TTSController.ts:1047` (`new TTSController(appService, view, !!user?.id, …)` in `useTTSControl.ts`). Note the exact condition under which a signed-in web reader can use the proxy, and what happens when the token is missing or expired.

- [ ] **Step 3: Record the diagnosis**

Append a "Diagnosis" section to the design doc naming the failing leg (direct `wss`, proxy, or another cause such as the init timeout), the exact error observed, and the evidence for it. If both legs work from the sandbox, say so and name the next suspect (for example, the probe never running because the client is never initialized).

- [ ] **Step 4: Commit**

```bash
git add apps/readest-app/docs/superpowers/specs/2026-11-19-edge-tts-background-audio-design.md
git commit -m "docs: record Edge TTS diagnosis (failing leg + error)"
```

### Task 2: Re-enable Edge probing and listing in `TTSController.init`

**Files:**
- Modify: `apps/readest-app/src/services/tts/TTSController.ts` (`init()`, ~lines 525-575)
- Test: `apps/readest-app/src/__tests__/services/tts-controller-edge.test.ts` (new; follows the naming of `src/__tests__/services/edge-tts-client.test.ts`)

**Interfaces:**
- Consumes: `EdgeTTSClient.init()` (returns `Promise<boolean>`; `false` when the `wss` probe fails and no `https` fallback applies), `EdgeTTSClient.getAllVoices()` (static Edge voice list), the existing `withinEngineTimeout` helper
- Produces: `this.ttsEdgeClient` probed in `init()`; Edge voices listed in the voice picker through the same aggregation as the web/readest/custom voices

- [ ] **Step 1: Write the failing test**

In the new test file, mock the Edge client so `init()` resolves `false` and assert the controller still finishes init, selects the web client, and lists no Edge voices; then mock it resolving `true` with two voices and assert the voices are listed in the picker groups. Model the mocks on `src/__tests__/services/edge-tts-client.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/__tests__/services/tts-controller-edge.test.ts`
Expected: FAIL — Edge voices never appear because `init()` never probes the Edge client.

- [ ] **Step 3: Implement the probe in `TTSController.init()`**

Remove the fork comment ("Edge TTS is removed from the voice picker…") and: start `const edgeReady = withinEngineTimeout(this.ttsEdgeClient.init(), false)` alongside the other probes; when `edgeReady` is true, add the Edge client to `availableClients` and include its voices in the voice aggregation (add a `ttsEdgeVoices` entry to the voices tuple next to `ttsWebVoices` / `ttsReadestVoices` / `ttsCustomVoices`, and include Edge voices in `getVoices(lang)` at ~line 2396 the same way the other clients are included). Do not change the native-client-first order on Tauri.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/__tests__/services/tts-controller-edge.test.ts`
Expected: PASS, including the test that pins the fallback: when Edge init fails, the player still opens with device TTS and does not hang.

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/tts/TTSController.ts apps/readest-app/src/__tests__/services/tts-controller-edge.test.ts
git commit -m "feat(tts): re-enable Edge TTS probing and voice listing on web"
```

### Task 3: Fix the leg Task 1 found broken

**Files:**
- Modify: whichever file owns the failing leg (see candidates below)
- Test: extend `apps/readest-app/src/__tests__/services/tts-controller-edge.test.ts` (or the leg's own existing test file when one exists)

**Interfaces:**
- Consumes: the diagnosis recorded in Task 1 (failing leg + exact error)
- Produces: the fixed leg, with a test that fails before the fix and passes after

- [ ] **Step 1: Write the failing test for the broken leg**

Known candidates (pick the one Task 1 named): direct `wss` handshake rejected by the browser (fix in `src/libs/edgeTTS.ts`, e.g. headers/origin the browser strips); `https` proxy called without the `Authorization` header (fix in `src/libs/edgeTTS.ts` `https` transport); proxy 403 for a signed-in reader because `isAuthenticated` is false at controller construction (fix where `useTTSControl.ts` builds the controller). The test asserts the exact failing behaviour from Task 1.

- [ ] **Step 2: Run test to verify it fails**

Run the test file from Step 1.
Expected: FAIL with the Task 1 error.

- [ ] **Step 3: Implement the minimal fix for that leg only**

Change only the failing leg. Do not open the proxy to signed-out users and do not add a new transport.

- [ ] **Step 4: Run test to verify it passes**

Run the test file from Step 1.
Expected: PASS, including the test that pins the cache key: cached audio for a sentence is keyed by voice id, so switching voices never replays another voice's audio.

- [ ] **Step 5: Commit**

```bash
git add <leg file(s)> <test file(s)>
git commit -m "fix(tts): repair the Edge TTS <leg> leg (<one-line cause>)"
```

### Task 4: Prefer a real-audio client as the web default

**Files:**
- Modify: `apps/readest-app/src/services/tts/TTSController.ts` (`init()`, default selection after `availableClients` is built)
- Test: `apps/readest-app/src/__tests__/services/tts-controller-edge.test.ts`

**Interfaces:**
- Consumes: `TTSCapabilities.mediaClock` (true for real-audio clients, false for the direct-speak web client), `TTSUtils.getPreferredClient()` (a remembered voice choice still wins)
- Produces: `this.ttsClient` set to the first available client with `mediaClock: true` on web when one is ready; device TTS remains the fallback

- [ ] **Step 1: Write the failing test**

Extend the Task 2 test file: with Edge ready and no remembered preference, assert `ttsClient` is the Edge client; with Edge not ready, assert `ttsClient` is the web client; with a remembered preference for the web client, assert the preference still wins.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test --run src/__tests__/services/tts-controller-edge.test.ts`
Expected: FAIL — the default is still `availableClients[0]` (the web client).

- [ ] **Step 3: Implement the capability-gated default**

After `availableClients` is built and before the remembered-preference override, select the first available client whose `getCapabilities().mediaClock` is `true` — on web only; leave the Tauri order (native first) untouched. Gate on the capability, never on the client name.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/__tests__/services/tts-controller-edge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/readest-app/src/services/tts/TTSController.ts apps/readest-app/src/__tests__/services/tts-controller-edge.test.ts
git commit -m "feat(tts): prefer a real-audio voice as the web default"
```

### Task 5: Signed-out reader gets the sign-in prompt, not silence

**Files:**
- Modify: none expected (`tts-need-auth` already exists); only change code if the test below finds the prompt missing
- Test: `apps/readest-app/src/__tests__/hooks/useTTSControl.test.tsx` (extend if the path is untested)

**Interfaces:**
- Consumes: the `tts-need-auth` event dispatched by `EdgeTTSClient.init()` when every probe fails for a signed-out reader, and `handleNeedAuth` in `useTTSControl.ts:413`
- Produces: a signed-out reader who picks an Edge voice sees the existing sign-in prompt

- [ ] **Step 1: Write the failing test**

In `useTTSControl.test.tsx`, simulate a signed-out reader (`user` null) picking an Edge voice with all Edge probes failing, and assert the sign-in prompt is shown (the same prompt `handleNeedAuth` raises). If the path is already covered by an existing test, name that test instead and skip to Step 3.

- [ ] **Step 2: Run test to verify it fails (or passes already)**

Run: `pnpm test --run src/__tests__/hooks/useTTSControl.test.tsx`
Expected: FAIL if the prompt path is untested/unwired; PASS if it is already covered — then no code change in this task.

- [ ] **Step 3: Implement only if Step 2 failed**

Wire the missing link with the minimal change (do not invent a new prompt).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test --run src/__tests__/hooks/useTTSControl.test.tsx`
Expected: PASS, including the test that pins the 403 case: a proxy 403 for an expired token raises the sign-in prompt instead of leaving a stuck spinner.

- [ ] **Step 5: Commit**

```bash
git add <changed files, if any> apps/readest-app/src/__tests__/hooks/useTTSControl.test.tsx
git commit -m "fix(tts): sign-in prompt when Edge TTS needs auth"
```

### Task 6: Verify and ship

**Files:**
- Modify: none (verification + PR only)

**Interfaces:**
- Consumes: the branch from Tasks 1–5; the Vercel preview deployment for the PR
- Produces: a PR to `main` with a public-safe description, and a phone-verification checklist for the user

- [ ] **Step 1: Format, typecheck, and run the affected tests**

Run: `pnpm format`, `pnpm lint`, `pnpm test --run src/__tests__/services/tts-controller-edge.test.ts src/__tests__/hooks/useTTSControl.test.tsx src/__tests__/services/edge-tts-client.test.ts`
Expected: all pass. (No `node_modules` in this sandbox: run these through the PR's CI if the sandbox cannot.)

- [ ] **Step 2: Push the branch and open the PR**

Push `edge-tts-background-audio` and open a PR to `main` titled "Re-enable Edge TTS on web for background audio". The description states the mechanism only (no user ids, emails, or counts): Edge TTS re-enabled, real-audio default on web, device TTS fallback, sign-in prompt when auth is needed.

- [ ] **Step 3: Check the PR's web build is green**

The `build_web_app` check must be green; the `build_tauri_app` check skips when no Tauri files change (as PR #3 showed). Do not merge on a red web build.

- [ ] **Step 4: Verify on the Vercel preview deployment**

Open the preview, sign in, open a book, open the voice picker and confirm Edge TTS voices are listed, play a sentence and confirm audio plays and the sentence highlights. Record the preview URL in the PR.

- [ ] **Step 5: Hand the phone checklist to the user**

Do not merge until the user confirms on his phone: play with an Edge voice, go to the home screen, audio keeps playing, lock-screen controls work, sentence highlighting follows. Then merge the PR (merge commit, as PR #3).

## Self-Review

1. **Spec coverage:** every goal in the design maps to a task — background playback (Tasks 2–4 + 6), highlighting preserved (existing `BufferedTTSClient` word boundaries; Task 6 verifies it live), Edge in the picker (Task 2), Edge default on web (Task 4), device fallback (Tasks 2, 4), sign-in prompt (Task 5), separate PR (Task 6).
2. **Step scan:** each step names one action and its check; no step carries more than one decision.
3. **Type consistency:** `ttsEdgeClient` / `ttsEdgeVoices` / `mediaClock` / `tts-need-auth` are the names used consistently across tasks, matching the existing code.
4. **Review Focus:** all five failure modes have a test pinned to an owning task (Tasks 2, 3, 5, 6).
5. **Proportion:** the plan is shorter than the code it changes; bodies are signatures and assertions, not transcripts.
