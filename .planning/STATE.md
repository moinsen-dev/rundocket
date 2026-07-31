# RunDocket state

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-31)

**Core value:** An AI coding agent can build, test, and launch an app through one
reliable machine contract without framework-specific command knowledge.

**Current focus:** Phase 2 execution/evidence completion plus the thin MCP slice
of Phase 5.

## Current status

- Initial public repository publication uses branch `main`.
- Phase 1 read-only discovery remains verified.
- Doctor probes framework tools, sanitized authentication, Expo dev servers,
  and booted/connected devices.
- Build, test, app launch, and logs can be planned with deterministic source-
  and toolchain-bound plan IDs.
- A modern/legacy-compatible stdio MCP server exposes the shared core.
- Local Expo MCP routes, screenshot, view, and log providers are integrated.
- Approved Expo development-server start, status, cancellation, bounded output,
  stale-plan rejection, and freshness-aware evidence are implemented.
- Build, test, app launch, remote EAS mutation, signing, upload, and release
  execution are not verified.

## Verification gate

```bash
npm install
npm run check
npm audit --omit=dev
```

Seventeen automated tests plus the CLI smoke check pass. A real Umkreis MCP
acceptance run also passed for routes, screenshot, logs, isolated Expo start,
status, cancellation, and evidence. Successful view lookup remains open because
Umkreis currently has no React Native `testID`.

See `.planning/VERIFICATION.md`.

## Next action

Complete the Phase 2 execution/evidence contract for one bounded short-lived
adapter operation before expanding build/test/launch claims across native Apple,
Flutter, and Expo.
