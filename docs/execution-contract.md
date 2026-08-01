# Execution contract

Schemas:

- `rundocket.run.v2`
- `rundocket.evidence.v2`
- `rundocket.await.v1`
- `rundocket.signals.v1`

The execution kernel runs verified Expo `start`, `build`, `launch`, and `test`
operations as managed local processes with an explicit completion contract.

## Why completion is not process exit

A development command frequently finishes its useful work long before its
process ends. `expo run:ios` builds the app, installs it, launches it, and then
keeps Metro in the foreground indefinitely. `expo start` never exits at all. An
agent that waits for process exit therefore waits for a signal that never
arrives, and raw output gives it no way to tell "still compiling" from "finished
twenty minutes ago".

RunDocket separates the two timelines:

- **Process lifecycle** — `state`: `running`, `cancelling`, `succeeded`,
  `failed`, `cancelled`.
- **Work lifecycle** — `lifecycle.phase` along the ordered milestones
  `starting -> resolving -> compiling -> built -> installed -> serving`.

Each adapter operation declares which milestone means done and whether the
command exits by itself. The plan carries that contract in `adapter.signals`
*before* execution, so an agent knows what it will be waiting for.

## Flow

1. Call `operation_plan`. Read `adapter.signals` for the completion milestone,
   the expected milestone chain, and `completesOnExit`.
2. Call `operation_apply` with the `planId` and `approved: true`.
3. Call `operation_await` with the returned `runId`. It blocks until there is
   something to report and returns a `rundocket.await.v1` result.
4. Use `operation_status` for an unblocking snapshot, `operation_cancel` to stop
   the process group, and `evidence_get` for the full bundle.

Do not poll `operation_status` in a loop. `operation_await` exists so that a
single call returns exactly when the state changes.

## operation_await

| Input | Meaning |
|-------|---------|
| `runId` | The managed run. |
| `until` | `completion` (default), `exit`, or a specific milestone. |
| `timeoutMs` | 1000–3600000, default 300000. |

The wait ends on any of: the requested target, a fatal diagnostic, process exit,
or the timeout. Silence is never treated as success.

| `outcome` | Meaning |
|-----------|---------|
| `completed` | The requested target was reached. |
| `failed` | A fatal diagnostic fired, or the process exited non-zero. |
| `exited` | The process ended before reaching the target. |
| `cancelled` | The run was cancelled. |
| `timeout` | Nothing terminal happened within `timeoutMs`. |

`cause` carries the diagnostic that ended the wait when the outcome is `failed`.

The run snapshot reports `lifecycle.completion.processOutlivesCompletion`. When
it is `true`, the work is done and the process is still serving on purpose —
waiting for exit at that point would never return.

## Declared completion per operation

| Adapter | Operation | Command | Completion | Exits |
|---------|-----------|---------|------------|-------|
| Expo | `start` | `expo start --port` | `serving` | no |
| Expo | `launch` | `expo run:<platform>` | `installed` | no |
| Expo | `build` | `expo run:<platform> --no-bundler` | `installed` | yes |
| Expo | `test` | `npm test` | `built` | yes |
| Flutter | `launch` | `flutter run` | `serving` | no |
| Flutter | `build` | `flutter build <platform>` | `built` | yes |
| Xcode | `build`/`test` | `xcodebuild` | `built` | yes |

Only the Expo rows are executable today. The remaining rows are planned and
carry their signal contract so the intent stays visible.

Expo has no local build command that stops before installing, so `build` is
`run:<platform> --no-bundler`: it performs the same work but terminates instead
of holding a bundler. The plan discloses this in `diagnostics`, because the
installed app then needs a separately running development server.

## Diagnostics

Output lines are classified as they arrive. Structured diagnostics carry
`severity`, `code`, `message`, and `fatal`. A fatal diagnostic — a failed
`xcodebuild`, a failed Gradle task, a `CommandError`, an unavailable device,
missing signing — ends a wait even while the process keeps running.

Non-fatal diagnostics such as individual compiler errors are recorded but do not
end a wait, because a build can log an error line and still recover.

## Environment

`adapter.command.env` carries the environment an adapter requires, applied on top
of the inherited process environment and included in the plan hash. Apple builds
receive `LANG`/`LC_ALL=en_US.UTF-8`, because CocoaPods under Ruby 3.4+ aborts
with an ASCII-8BIT normalization error when a process is spawned by an agent
runtime with no UTF-8 locale.

## Gates

- `approved: true` is mandatory for local mutation.
- Apply recomputes the plan; a different source/toolchain fingerprint returns
  `STALE_PLAN`.
- An occupied requested port returns `PORT_IN_USE` for `start`.
- Any operation outside verified Expo start/build/launch/test returns
  `EXECUTION_UNAVAILABLE` or `EXECUTION_NOT_IMPLEMENTED`.
- Cancellation targets only the process group of the supplied `runId`.

## Output and evidence

Stdout and stderr are captured separately and bounded to 32 KiB from the head
plus 96 KiB from the tail, with the omitted middle marked inline and counted in
`output.omittedBytes`. The head is preserved deliberately: a build failure names
its cause near the start and repeats only follow-up noise at the end.

Evidence contains the immutable plan, the run snapshot, source binding, and
whether current sources are `fresh`, `stale`, or `unverified`.

Runs are session-local in this phase. Closing the MCP connection cancels active
managed processes; no detached daemon is left behind. Runs therefore do not
survive an agent restart — that gate is open.
