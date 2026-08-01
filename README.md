# RunDocket

RunDocket is a headless, AI-first execution layer for app development. It gives
coding agents one framework-neutral contract for Xcode, Flutter, and Expo
workspaces instead of requiring framework-specific command knowledge.

The current implementation provides:

- read-only workspace inspection and project ownership;
- read-only toolchain, authentication, dev-server, and device readiness;
- immutable, source-bound plans for build, test, launch, and logs;
- a completion contract that tells an agent which milestone means done, so a
  long build reports finished work instead of an open process;
- approval-gated Expo start, build, launch, and test as managed local processes
  with milestone waiting, structured diagnostics, cancellation, bounded output,
  and freshness-aware evidence;
- a headless MCP 2026-07-28 stdio server with legacy compatibility;
- local Expo MCP providers for routes, screenshots, view inspection, and logs.

Native Apple and Flutter execution, signing, upload, submission, and release are
not claimed. Runs do not survive the MCP session. UI mutation through Expo
`automation_tap` also remains blocked.

## Waiting without guessing

`expo run:ios` builds the app, installs it, launches it, and then keeps Metro in
the foreground. Its process never exits, so an agent that waits for exit waits
forever on work that finished minutes ago.

RunDocket separates the work lifecycle from the process lifecycle. Every plan
declares its completion milestone up front:

```text
Command preview: expo run:ios --device A6049A0C-…
Completion: installed (the process keeps running afterwards)
Milestones: starting -> resolving -> compiling -> built -> installed -> serving
```

`operation_await` then blocks until that milestone is reached, a fatal
diagnostic fires, the process exits, or the timeout expires — one call instead of
a polling loop, and silence is never read as success.

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm install -g rundocket

rundocket inspect /path/to/app --json
rundocket doctor /path/to/app --json
rundocket plan launch /path/to/app --platform ios --device-id <udid>
```

The command surface is:

```text
rundocket inspect [path] [--json]
rundocket doctor [path] [--json] [--project <id>]
rundocket plan <start|build|test|launch|logs> [path] [options]
rundocket skill path
rundocket mcp
rundocket-mcp
```

From a source checkout instead:

```bash
npm install
npm run check
npm run build
node dist/src/cli.js inspect /path/to/app --json
```

## Agent Skill

RunDocket includes a portable Agent Skill for coding agents that support the
open Agent Skills format. The skill ships inside the npm package, so installing
it from the CLI's own path keeps the workflow instructions and the contract they
describe on the same version:

```bash
npx skills add "$(rundocket skill path)" -g -a claude-code -y
```

Repeat with `-a codex` or any other supported agent; the installer accepts one
agent per invocation.

Without a local installation, the skill can also be taken straight from the
repository:

```bash
npx skills add moinsen-dev/rundocket --list
npx skills add moinsen-dev/rundocket --skill rundocket
```

RunDocket does not install the skill itself. Agent directory conventions belong
to the installer; encoding them here would tie a framework-neutral execution
contract to a list of agent runtimes.

The skill is a thin, model-neutral workflow over RunDocket; it does not bundle
or silently install the CLI. It resolves a project-local or `PATH` executable,
or a built source checkout configured through `RUNDOCKET_CLI` or
`RUNDOCKET_REPO`.

## MCP

Build the repository, then configure an MCP client to launch the absolute
server path:

```json
{
  "mcpServers": {
    "rundocket": {
      "command": "node",
      "args": [
        "/absolute/path/to/rundocket/dist/src/mcp-cli.js"
      ]
    }
  }
}
```

RunDocket exposes:

- `workspace_inspect`
- `capabilities_list`
- `operation_plan`
- `operation_apply`
- `operation_await`
- `operation_status`
- `operation_cancel`
- `evidence_get`
- `expo_router_sitemap`
- `expo_take_screenshot`
- `expo_find_view`
- `expo_collect_logs`

Every tool requires an explicit `workspacePath`; RunDocket does not rely on
deprecated implicit MCP roots. The client launches the server over stdio, and
all protocol messages use stdout while diagnostics use stderr.

See [docs/mcp.md](docs/mcp.md) for provider requirements and safety behavior.

## Expo local provider

An Expo project needs its normal dependencies, `expo-mcp`, and a running local
development server:

```bash
npx expo install expo-mcp --dev
EXPO_UNSTABLE_MCP_SERVER=1 npx expo start
```

RunDocket accepts only loopback development-server URLs for the local provider.
Screenshots and logs may be proxied through Expo tooling, so automation sessions
must use test data rather than production user data.

## Contracts

The stable agent workflow is:

```text
inspect -> capabilities -> plan -> apply -> await -> verify
```

The first three stages are implemented for all three adapters. `apply`, `await`,
status, cancellation, and evidence are implemented for verified Expo start,
build, launch, and test. Native Apple and Flutter execution remains a future
gate; their plans already declare a completion contract.

- [Inspect contract](docs/inspect-contract.md)
- [Doctor contract](docs/doctor-contract.md)
- [Plan contract](docs/plan-contract.md)
- [Execution contract](docs/execution-contract.md)
- [MCP integration](docs/mcp.md)

## Verification

```bash
npm run typecheck
npm test
npm run smoke
npm run check
```

The automated suite covers discovery, ambiguity, readiness, deterministic plan
IDs, stale-plan rejection, managed process cancellation, freshness-aware
evidence, CLI JSON contracts, and separate modern and legacy stdio MCP
handshakes.

## Project status

RunDocket is an early public prototype. Its contracts and command surface may
change before a stable release, and the unverified execution gates described
above remain intentionally unavailable.

## License

RunDocket is available under the [MIT License](LICENSE).
