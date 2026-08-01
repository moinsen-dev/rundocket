# RunDocket verification

**Date:** 2026-08-01
**Runtime:** Node.js 22.23.1, TypeScript 7.0.2, MCP SDK 2.0.0

## Automated scope

Verified:

- Phase 1 Xcode, Flutter, Expo, ownership, ambiguity, and JSON contracts;
- Doctor readiness and sanitized provider state;
- deterministic source-bound plans and missing-input behavior;
- approved-only Expo start, build, launch, and test;
- stale-plan rejection after source changes;
- milestone completion while the process keeps running, fatal-diagnostic
  interruption without a process exit, exit-based completion, milestone timeout,
  and head/tail-preserving bounded output;
- managed process status, process-group cancellation, bounded output, duration,
  and freshness-aware evidence;
- modern MCP 2026-07-28 stdio discovery and core tool calls;
- a separate legacy MCP initialization and core tool call;
- portable Agent Skill CLI resolution and explicit-invalid-path rejection;
- Agent Skill schema validation, local `npx skills` discovery/installation,
  and an independent read-only Expo ownership/build-boundary exercise.

Not verified:

- native Apple and Flutter execution adapters;
- Expo Android build, launch, and test execution;
- cross-session durable run recovery;
- remote Expo MCP OAuth proxying;
- EAS build/workflow mutation;
- signing, physical-device release acceptance, upload, submission, or release.

## Commands

```bash
npm install
npm run check
npm audit --omit=dev
npx --yes skills@latest add . --list
uvx --from skills-ref agentskills validate skills/rundocket
```

## Result

- TypeScript typecheck: PASS
- Automated tests: PASS (26/26)
- CLI smoke check: PASS
- Dependency audit: PASS (0 vulnerabilities)
- Agent Skill quick validation and Agent Skills specification: PASS
- Local `npx skills` discovery and isolated installation: PASS
- Independent Skill exercise: PASS (Expo primary, Xcode embedded, build
  correctly reported as planned rather than executable)
- Repository baseline: public `main` branch after the initial bootstrap

## Fixture matrix

| Fixture | Expected | Observed |
|---------|----------|----------|
| Expo managed | One primary Expo app | PASS |
| Expo prebuilt | Expo primary, Xcode embedded | PASS |
| Flutter iOS | Flutter primary, Xcode embedded | PASS |
| Native Xcode | One primary Xcode app root | PASS |
| Monorepo | `NEEDS_INPUT`, two candidates | PASS |
| Unsupported | `UNVERIFIED` | PASS |
| Fake Expo lifecycle | approval, start, cancel, fresh/stale evidence | PASS |
| Fake Expo run | milestone chain, completion while running, fatal diagnostic | PASS |
| Agent Skill | resolver, discovery, installation, ownership boundary | PASS |

## Umkreis acceptance

Workspace: external Umkreis Expo app checkout

Observed through RunDocket MCP:

- selected project: Expo prebuilt, iOS/Android/web;
- local Expo MCP 0.2.4 and Metro 8081 available;
- Expo and EAS CLI sessions authenticated without returning identities;
- five Expo Router routes, no collisions;
- one JPEG simulator screenshot;
- JavaScript log collection completed;
- missing test view normalized to `UNVERIFIED`/`isError: true`;
- isolated Expo server started on port 65366 with a verified plan and run ID;
- run cancelled, matching plan/apply source fingerprints returned;
- port 65366 closed; existing port 8081 server remained listening.

Successful view inspection remains `unverified` until the app exposes a stable
React Native `testID`.

## Completion-contract acceptance (2026-08-01)

Workspace: external Umkreis Expo app checkout, booted iOS 26.4 simulator
`A6049A0C-…`, existing Metro on 8081.

`start` on an isolated port 8097:

- plan declared `completion=serving`, `completesOnExit=false`;
- `operation_await` returned `completed` after 1.2 s with `phase=serving`,
  process state `running`, `processOutlivesCompletion=true`.

`build` as `expo run:ios --device … --no-bundler`:

- observed milestone chain `starting -> resolving -> compiling -> built -> installed`;
- `operation_await` returned `completed` after 14.0 s while the process kept
  running; no diagnostics; run cancelled on shutdown.

Two contract corrections came out of this run and are now covered by tests:

- `--no-bundler` does **not** make `expo run:ios` terminate; the earlier
  `completesOnExit: true` assumption was wrong;
- the real iOS order is `Build Succeeded` -> `Waiting on http://…` ->
  `› Installing …`, so the bundler line is not a milestone for `run`, and the
  install marker is `› Installing <path>`, not `Installing on <device>`.
