# RunDocket verification

**Date:** 2026-07-31
**Runtime:** Node.js 22.23.1, TypeScript 7.0.2, MCP SDK 2.0.0

## Automated scope

Verified:

- Phase 1 Xcode, Flutter, Expo, ownership, ambiguity, and JSON contracts;
- Doctor readiness and sanitized provider state;
- deterministic source-bound plans and missing-input behavior;
- approved-only Expo start;
- stale-plan rejection after source changes;
- managed process status, process-group cancellation, bounded output, duration,
  and freshness-aware evidence;
- modern MCP 2026-07-28 stdio discovery and core tool calls;
- a separate legacy MCP initialization and core tool call.

Not verified:

- successful app build, test, or launch execution;
- native Apple and Flutter execution adapters;
- cross-session durable run recovery;
- remote Expo MCP OAuth proxying;
- EAS build/workflow mutation;
- signing, physical-device release acceptance, upload, submission, or release.

## Commands

```bash
npm install
npm run check
npm audit --omit=dev
```

## Result

- TypeScript typecheck: PASS
- Automated tests: PASS (17/17)
- CLI smoke check: PASS
- Dependency audit: PASS (0 vulnerabilities)
- Repository status at verification time: pre-first-commit bootstrap

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
