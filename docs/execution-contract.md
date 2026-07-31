# Execution contract

Schemas:

- `rundocket.run.v1`
- `rundocket.evidence.v1`

The initial execution kernel is available through one MCP session. It currently
executes only a verified Expo `start` plan.

## Flow

1. Call `operation_plan` with operation `start` and an optional port.
2. Inspect the plan, including risk, command, source fingerprint, and
   `approvalRequired`.
3. Call `operation_apply` with the returned `planId` and `approved: true`.
4. Use `operation_status` with the returned `runId`.
5. Use `operation_cancel` to stop the managed process group.
6. Use `evidence_get` for the plan, command, bounded output, result, duration,
   source binding, and freshness.

Plans exist only in the current MCP session. Calling apply without first
registering the plan returns `PLAN_NOT_FOUND`.

## Gates

- `approved: true` is mandatory for local mutation.
- Apply recomputes the plan; a different source/toolchain fingerprint returns
  `STALE_PLAN`.
- An occupied requested port returns `PORT_IN_USE`.
- Any operation other than verified Expo start returns
  `EXECUTION_UNAVAILABLE` or `EXECUTION_NOT_IMPLEMENTED`.
- Cancellation targets only the process group associated with the supplied
  RunDocket `runId`.

## Output and lifecycle

Run state is one of:

- `running`
- `cancelling`
- `succeeded`
- `failed`
- `cancelled`

Stdout and stderr are captured separately and bounded to 128 KiB each. Evidence
contains exit code, signal, cancellation flag, duration, command, plan/apply
source fingerprints, and whether the current sources are `fresh`, `stale`, or
`unverified`.

Runs are intentionally session-local in this phase. Closing the MCP connection
cancels active managed processes; no detached daemon is left behind.
