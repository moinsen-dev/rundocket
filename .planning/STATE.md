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
- A portable Agent Skill delegates to the CLI/MCP contract through a safe local
  resolver and is discoverable and installable with `npx skills`.
- Local Expo MCP routes, screenshot, view, and log providers are integrated.
- Plans declare a completion contract (`adapter.signals`): the milestone that
  means done, the expected milestone chain, and whether the command exits.
- `operation_await` blocks until a milestone, a fatal diagnostic, process exit,
  or a timeout, so an agent no longer polls or guesses when a build is finished.
- Approved Expo start, build, launch, and test run as managed processes with
  classified diagnostics, head/tail-bounded output, status, cancellation,
  stale-plan rejection, and freshness-aware evidence.
- Native Apple and Flutter execution, Expo Android, remote EAS mutation,
  signing, upload, and release execution are not verified.
- Runs remain session-local; they do not survive an agent restart.

## Verification gate

```bash
npm install
npm run check
npm audit --omit=dev
```

Twenty-six automated tests plus the CLI smoke check pass. A real Umkreis MCP
acceptance run also passed for routes, screenshot, logs, isolated Expo start,
status, cancellation, and evidence. A second acceptance run drove a real
`expo run:ios` build to its `installed` milestone in 14 s while the process kept
running. Successful view lookup remains open because Umkreis currently has no
React Native `testID`.

Both Agent Skills validators, local `npx skills` discovery/installation, and an
independent read-only Expo prebuilt ownership/build-boundary exercise pass.

See `.planning/VERIFICATION.md`.

## Next action

Decide whether runs should survive the MCP session. Everything else in the
autonomy chain now works within one session, but a compaction or agent restart
still loses the run IDs and kills the managed processes. That change introduces
detached processes and a state directory, so it needs an explicit safety
decision before implementation.
