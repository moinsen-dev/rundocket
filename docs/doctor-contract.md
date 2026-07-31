# Doctor contract

Schema: `rundocket.doctor.v1`

`rundocket doctor` probes prerequisites without changing the workspace. It
returns a selected primary project, provider readiness, normalized
capabilities, and sanitized diagnostics.

## Command

```bash
rundocket doctor [path] \
  [--project <project-id>] \
  [--expo-dev-server-url <loopback-url>] \
  [--json]
```

## Status

The command preserves the canonical inspection statuses:

| Status | Meaning |
|---|---|
| `VERIFIED` | A primary project was selected and readiness probing completed |
| `NEEDS_INPUT` | Multiple primary projects or an invalid explicit selection require input |
| `UNVERIFIED` | No supported primary app is available |

`VERIFIED` means the probe completed. It does not mean every provider or
operation is ready. Each tool and capability carries its own availability.

## Availability

| Availability | Meaning |
|---|---|
| `available` | The prerequisite or implemented operation was verified |
| `needs_auth` | The tool exists but does not report an authenticated session |
| `needs_server` | A required local development server was not found |
| `needs_input` | The caller must choose a project or operation input |
| `unavailable` | A required executable, package, or device was not found |
| `unverified` | The probe cannot currently establish readiness |
| `planned` | The contract is known but execution is not implemented |
| `blocked` | Safety policy intentionally denies the operation |

Authentication probes return only `true`, `false`, or `null`. Usernames, email
addresses, credentials, tokens, and raw process environments are not returned.

## Expo

For a selected Expo project, Doctor reports separate readiness for:

- project-local Expo CLI;
- local `expo-mcp`;
- loopback Expo development server;
- booted iOS simulators and connected Android devices;
- EAS CLI and sanitized authentication state.

EAS readiness is not an execution claim. Remote builds, submissions, review
replies, signing, and release remain blocked or planned.
