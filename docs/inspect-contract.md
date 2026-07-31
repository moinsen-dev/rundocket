# Inspect contract

Schema: `rundocket.inspect.v1`

`rundocket inspect` is always read-only. Detection is based on explicit evidence
and can return more than one project.

## Canonical statuses

| Status | Meaning | Exit code |
|---|---|---:|
| `VERIFIED` | Exactly one primary app was detected | `0` |
| `FAILED` | Inspection could not complete | `1` |
| `NEEDS_INPUT` | Multiple primary apps require selection | `20` |
| `UNVERIFIED` | No supported app project was detected | `30` |

## Project roles

- `primary`: an app the user or agent can select directly.
- `embedded`: a native platform project owned by a higher-level framework.

For example, an Expo repository with an `ios/` directory produces one primary
Expo project and one embedded Xcode project. The Xcode project is evidence of a
native platform, not a competing primary app.

## Evidence

Every project contains an `evidence` array. Each entry identifies:

- the marker type;
- a workspace-relative path;
- a short explanation of why the marker matters.

Confidence is derived from the available marker set. It is not a substitute for
evidence and must never hide ambiguity.

## Selection

- `selected`: one primary project is available.
- `needs_input`: two or more primary projects are available.
- `unsupported`: no primary project is available.

Later commands will accept an explicit project ID for monorepos.

## Detection references

- [Expo app configuration](https://docs.expo.dev/workflow/configuration/)
- [Expo native project lifecycle](https://docs.expo.dev/workflow/overview/)
- [Flutter pubspec options](https://docs.flutter.dev/tools/pubspec)
- [Apple projects and workspaces](https://developer.apple.com/documentation/xcode/managing-multiple-projects-and-their-dependencies)
