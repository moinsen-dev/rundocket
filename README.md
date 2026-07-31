# RunDocket

RunDocket is a headless, AI-first execution layer for app development. It gives
coding agents one framework-neutral contract for Xcode, Flutter, and Expo
workspaces instead of requiring framework-specific command knowledge.

The current implementation provides:

- read-only workspace inspection and project ownership;
- read-only toolchain, authentication, dev-server, and device readiness;
- immutable, source-bound plans for build, test, launch, and logs;
- approval-gated Expo development-server start with run status, cancellation,
  bounded output, and freshness-aware evidence;
- a headless MCP 2026-07-28 stdio server with legacy compatibility;
- local Expo MCP providers for routes, screenshots, view inspection, and logs.

Execution of build, test, app launch, signing, upload, submission, and release is
not claimed. UI mutation through Expo `automation_tap` also remains blocked.

## Quick start

Requirements: Node.js 22 or newer.

```bash
npm install
npm run check
npm run build

node dist/src/cli.js inspect /path/to/app --json
node dist/src/cli.js doctor /path/to/app --json
node dist/src/cli.js plan start /path/to/app --port 8090 --json
```

The installed command surface is:

```text
rundocket inspect [path] [--json]
rundocket doctor [path] [--json] [--project <id>]
rundocket plan <start|build|test|launch|logs> [path] [options]
rundocket mcp
rundocket-mcp
```

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
inspect -> capabilities -> plan -> apply -> verify
```

The first three stages are implemented. `apply`, status, cancellation, and
evidence are implemented only for verified Expo development-server start.
Other adapter operations remain future gates.

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
