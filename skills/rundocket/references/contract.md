# RunDocket contract reference

Load this reference when choosing commands, interpreting statuses, planning an
operation, or using the MCP execution lifecycle.

## CLI surface

```text
rundocket inspect [path] [--json] [--max-depth <0-12>]
rundocket doctor [path] [--json] [--project <id>]
rundocket plan <start|build|test|launch|logs> [path] [options]
rundocket mcp
```

Relevant plan and readiness options include:

```text
--project <id>
--expo-dev-server-url <loopback-url>
--platform <name>
--scheme <name>
--configuration <name>
--destination <value>
--device-id <id>
--port <1024-65535>
--source <name>
```

Prefer `--json`. Preserve the returned schema, diagnostic codes, project IDs,
plan IDs, run IDs, and source fingerprints rather than reconstructing them from
human-readable output.

## Canonical workspace statuses

| Status | Meaning | Inspect exit code |
|---|---|---:|
| `VERIFIED` | Exactly one primary app was selected or the requested probe completed | `0` |
| `FAILED` | The operation could not complete | `1` |
| `NEEDS_INPUT` | Multiple primary apps or invalid selection require input | `20` |
| `UNVERIFIED` | No supported primary app was established | `30` |

An embedded native project belongs to its primary Expo or Flutter project. It
is a diagnosis boundary, not a competing app selection.

## Capability availability

| Availability | Meaning |
|---|---|
| `available` | The prerequisite or implemented operation was verified |
| `needs_auth` | The tool exists but authentication was not verified |
| `needs_server` | A required local server was not found |
| `needs_input` | A project or operation parameter is missing |
| `unavailable` | A required executable, package, or device was not found |
| `unverified` | Readiness cannot currently be established |
| `planned` | The contract exists but execution is not implemented |
| `blocked` | Safety policy denies the operation |

Top-level Doctor `VERIFIED` does not override a capability's own availability.

## Core MCP tools

| Tool | Mutation | Purpose |
|---|---|---|
| `workspace_inspect` | No | Detect projects and ownership |
| `capabilities_list` | No | Probe tools, auth, servers, and devices |
| `operation_plan` | No | Register a deterministic source-bound plan |
| `operation_apply` | Yes | Apply an approved plan from this session |
| `operation_await` | No | Block until a milestone, fatal diagnostic, exit, or timeout |
| `operation_status` | No | Read bounded output and process state |
| `operation_cancel` | Yes | Stop one managed process group by run ID |
| `evidence_get` | No | Read plan, result, output, binding, and freshness |

Minimum lifecycle inputs:

```json
{"workspacePath":"/path/to/app"}
```

```json
{
  "workspacePath": "/path/to/app",
  "projectId": "expo:.",
  "operation": "start",
  "parameters": {"port": 8090}
}
```

```json
{"planId":"plan_<32 hex characters>","approved":true}
```

```json
{"runId":"run_<uuid>"}
```

Plans and runs are local to one MCP session. Recreate the plan after reconnecting.

## Execution gates and errors

- `approved: true` is mandatory for local mutation.
- `PLAN_NOT_FOUND` means the plan was not registered in this MCP session.
- `STALE_PLAN` means sources, inputs, or toolchain evidence changed; replan.
- `PORT_IN_USE` means the requested local port is occupied; select another port
  and replan.
- `EXECUTION_UNAVAILABLE` or `EXECUTION_NOT_IMPLEMENTED` means the normalized
  operation cannot be applied through the current adapter.
- Cancellation may target only the process group identified by the RunDocket
  `runId`.

Run state is `running`, `cancelling`, `succeeded`, `failed`, or `cancelled`.
Evidence source state is `fresh`, `stale`, or `unverified`.

## Completion contract

Process state and work state are separate. Milestones are ordered
`starting -> resolving -> compiling -> built -> installed -> serving`, and every
plan declares in `adapter.signals` which one means done plus whether the command
exits by itself.

| Operation | Command | Completion | Exits |
|---|---|---|---|
| Expo `start` | `expo start --port` | `serving` | no |
| Expo `launch` | `expo run:<platform>` | `installed` | no |
| Expo `build` | `expo run:<platform> --no-bundler` | `installed` | no |
| Expo `test` | `npm test` | `built` | yes |

`operation_await` input:

```json
{"runId":"run_<uuid>","until":"completion","timeoutMs":1800000}
```

`until` accepts `completion` (default), `exit`, or a milestone name. `timeoutMs`
ranges from 1000 to 3600000 and defaults to 300000.

| `outcome` | Meaning |
|---|---|
| `completed` | The requested target was reached |
| `failed` | A fatal diagnostic fired or the process exited non-zero |
| `exited` | The process ended before reaching the target |
| `cancelled` | The run was cancelled |
| `timeout` | Nothing terminal happened in time; the run continues |

`lifecycle.completion.processOutlivesCompletion: true` means the work is done
and the process is still running on purpose. Waiting for its exit would never
return; cancel it once the evidence is captured.

`diagnostics` carries classified `severity`, `code`, `message`, and `fatal`
entries. Prefer them over re-reading raw output. Output keeps the head and tail
of each stream with the omitted middle marked inline.

## Current capability boundary

Verified now:

- read-only Xcode, Flutter, Expo, hybrid, and monorepo discovery;
- readiness probes and immutable plans;
- approved Expo `start`, `build`, `launch`, and `test` with milestone waiting,
  classified diagnostics, status, cancellation, and evidence;
- Expo router sitemap, screenshot, view lookup, and log collection when their
  local prerequisites are ready.

Not verified or intentionally absent:

- native Apple and Flutter execution adapters;
- generic UI mutation, including Expo tap;
- durable runs across MCP sessions;
- remote Expo MCP OAuth proxying and EAS mutations;
- signing, physical-device release acceptance, upload, submission, and release.
