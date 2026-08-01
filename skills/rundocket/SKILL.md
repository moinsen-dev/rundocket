---
name: rundocket
description: Inspect, diagnose, plan, and safely operate Xcode, Flutter, and Expo app workspaces through RunDocket's framework-neutral CLI or MCP contract. Use when an AI agent needs to identify the owning app in a repository, check local toolchain or device readiness, create source-bound plans, run and wait for a verified Expo build, launch, start, or test without guessing when a long-running command has finished, collect supported Expo evidence, or report why an app operation remains unavailable.
---

# RunDocket

Use RunDocket as the machine contract between an app-development request and
framework-specific tooling. Preserve its evidence, ambiguity, approval, and
default-deny boundaries.

## Establish The Interface

1. Resolve the app workspace separately from the RunDocket installation.
2. Prefer already-connected RunDocket MCP tools for the complete lifecycle.
3. Otherwise invoke the CLI through the bundled resolver:

   ```bash
   node "<skill-dir>/scripts/run.mjs" inspect "<workspace>" --json
   ```

   Resolve `<skill-dir>` as the directory containing this `SKILL.md`; do not
   assume the current working directory.
4. If the resolver returns `RUNDOCKET_NOT_FOUND`, report `NEEDS_SETUP` with its
   attempted locations. Do not silently replace the requested RunDocket flow
   with raw framework commands.
5. Read [references/contract.md](references/contract.md) before planning,
   applying, or interpreting a non-`VERIFIED` result.

The resolver accepts either `RUNDOCKET_CLI=/absolute/path/to/cli.js` or
`RUNDOCKET_REPO=/absolute/path/to/rundocket`. It also checks project-local
`node_modules/.bin`, a RunDocket source checkout containing the skill, and
`PATH`. It never downloads, installs, or builds software.

## Follow The Safe Workflow

### 1. Inspect

Call `workspace_inspect` or:

```bash
node "<skill-dir>/scripts/run.mjs" inspect "<workspace>" --json
```

- Treat detection as read-only.
- Use project evidence and ownership relationships; never promote an embedded
  Xcode project over its owning Expo or Flutter app.
- On `NEEDS_INPUT`, present the primary candidate IDs and select only from user
  intent or explicit repository evidence. Never guess.
- On `UNVERIFIED`, report the unsupported or missing markers instead of
  inventing a framework.

### 2. Check Readiness

Call `capabilities_list` or:

```bash
node "<skill-dir>/scripts/run.mjs" doctor "<workspace>" --project "<id>" --json
```

Interpret each capability independently. A top-level `VERIFIED` status means
the probe completed; it does not prove that every CLI, server, account, device,
or operation is ready. Never expose raw authentication output or credentials.

### 3. Plan

Call `operation_plan` or:

```bash
node "<skill-dir>/scripts/run.mjs" plan <start|build|test|launch|logs> \
  "<workspace>" --project "<id>" --json
```

Supply only relevant parameters. Inspect the selected project, operation,
command preview, risk, missing inputs, execution availability, source
fingerprint, and `planId`. Planning is not execution.

Read `adapter.signals` before applying. It declares the completion milestone,
the expected milestone chain, and whether the command exits on its own. Report
that contract to the user instead of promising a duration.

### 4. Apply Only A Verified And Authorized Plan

Use MCP `operation_apply`; the CLI intentionally has no general apply command.

- Apply only a plan registered in the current MCP session.
- Set `approved: true` only when the user explicitly requested that exact local
  mutation or approved the displayed plan.
- Require execution availability `available` and an unchanged plan/source
  binding.
- Treat `STALE_PLAN`, `PLAN_NOT_FOUND`, or changed inputs as a mandatory replan.
- Do not apply a `planned`, `blocked`, `unavailable`, or `unverified`
  capability.

The currently verified mutations are Expo `start`, `build`, `launch`, and
`test`. Do not claim native Apple or Flutter execution, generic log execution,
UI tap, EAS mutation, signing, upload, submission, or release support.

### 5. Wait With `operation_await`, Never With A Polling Loop

After `operation_apply`, call `operation_await` with the returned `runId`.

```json
{"runId": "run_…", "until": "completion", "timeoutMs": 1800000}
```

A local app build is not finished when its process exits — most development
commands never exit. `expo run:ios` builds, installs, launches, and then keeps
serving; `expo start` runs until cancelled. `operation_await` returns the moment
the declared milestone is reached, a fatal diagnostic fires, the process exits,
or the timeout expires.

- `completed` — the work is done. If `lifecycle.completion.processOutlivesCompletion`
  is `true`, the process is still running on purpose; cancel it when you are
  finished with it.
- `failed` — read `cause` and `diagnostics` for the classified reason rather
  than re-reading the raw output.
- `timeout` — the run continues; either wait again with a longer timeout or
  report the last milestone reached. Never report a timeout as a failure.
- Never treat silence or a still-running process as success.

Do not call `operation_status` in a loop, and do not guess a wait duration.

### 6. Capture Evidence And Clean Up

Use `operation_status` for an unblocking snapshot and `evidence_get` with the
`runId` for the full bundle. Distinguish process state (`running`, `succeeded`,
`failed`, `cancelled`), work state (`lifecycle.phase`, `lifecycle.milestones`),
and source evidence marked `fresh`, `stale`, or `unverified`.

Bounded output keeps the head and the tail of each stream with the omitted
middle marked inline; when diagnosing a failure, read the classified
`diagnostics` and the head before the tail.

Use `operation_cancel` only for the exact RunDocket-managed `runId`. Cancel a
run that outlived its completion once its evidence is captured, unless the user
asked to keep the server or app session active. Remember that active runs are
session-local and are cancelled when the MCP connection closes.

For supported Expo evidence, use router, screenshot, view, and log tools only
after readiness succeeds. Use test accounts and synthetic data because images
and logs can contain application data. Do not infer tap support from screenshot
or view-readiness support.

## Report Evidence, Not Confidence

End with:

- selected workspace, project ID, framework, and ownership;
- readiness relevant to the requested operation;
- whether the operation was inspected, planned, applied, or merely unavailable;
- exact plan and run IDs when present;
- the await outcome, the milestone reached, and whether the process is still
  running by design;
- terminal state and evidence freshness;
- remaining safety or capability gate;
- the next verifiable step.

Keep build success, simulator/device readiness, app launch, visual acceptance,
signing, and release as separate claims. Mark unavailable proof `unverified`.
