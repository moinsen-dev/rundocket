# Plan contract

Schema: `rundocket.plan.v1`

`rundocket plan` creates an immutable plan without executing a command.

## Command

```bash
rundocket plan <start|build|test|launch|logs> [path] [options] [--json]
```

Relevant options include project ID, platform, Xcode scheme/configuration/
destination, device ID, and log sources.

## Binding

A verified plan binds:

- canonical workspace root;
- selected primary project and owning adapter;
- normalized operation and parameters;
- safety risk;
- required inputs;
- command preview when one can be described safely;
- sanitized toolchain paths and versions;
- recursive SHA-256 source fingerprint.

`planId` is the first 32 hexadecimal characters of the SHA-256 digest of the
canonical plan inputs, prefixed with `plan_`. `generatedAt` is excluded, so the
same source and inputs produce the same ID.

The fingerprint excludes dependency/build/cache directories and does not follow
symlinks. It reports whether it was complete plus file and byte counts.

## Execution boundary

Expo `start` plans return execution availability `available` when the
project-local Expo CLI is present. They bind the selected loopback port and are
classified as `local_mutation`.

Build, test, app launch, and generic logs currently return execution
availability `planned` after required inputs are present. `build`, `test`, and
`launch` are classified as `local_mutation`; `logs` is `read_only`.

No command is executed by `plan`. The limited MCP `operation_apply` support
recomputes and matches the plan ID before starting Expo and produces run
evidence. Other operations cannot be applied.
