# MCP integration

RunDocket uses the current split TypeScript MCP v2 SDK and serves the
2026-07-28 protocol over stdio with legacy-client compatibility.

## Why stdio first

The AI client launches and owns the RunDocket process. This avoids a listening
port, daemon lifecycle, and local HTTP authentication while the contract is
being proven. A loopback Streamable HTTP mode may be added later for persistent
or multi-client use.

## Tools

### Core

- `workspace_inspect`: delegates to the same read-only discovery core as CLI.
- `capabilities_list`: delegates to Doctor.
- `operation_plan`: delegates to the immutable planner.
- `operation_apply`: applies a registered, approved, fresh plan for the
  currently verified execution subset.
- `operation_status`: returns state and bounded process output.
- `operation_cancel`: stops the managed process group for one run ID.
- `evidence_get`: returns the plan, result, source binding, and freshness.

### Expo evidence provider

- `expo_router_sitemap`
- `expo_take_screenshot`
- `expo_find_view`
- `expo_collect_logs`

RunDocket launches the project-local `expo-mcp` executable as an MCP child
client. It verifies the selected project is Expo, permits only loopback
development servers, requires a booted device for visual evidence, and forwards
text/image results through its own stable tool surface.

Expo MCP may encode an operation failure in text JSON while leaving the MCP
`isError` flag unset. RunDocket normalizes `success: false` view results to
`UNVERIFIED` and `isError: true`.

## Explicitly absent

- Expo `automation_tap`
- apply support beyond Expo development-server start
- remote Expo MCP OAuth proxying
- EAS build/workflow mutation
- signing, store submission, review reply, and release

These operations must not be inferred from provider readiness.

## Privacy

Screenshots and logs can contain application data and may pass through Expo
tooling. Use test accounts and synthetic data. RunDocket does not include raw
authentication output or child-process environments in results.

## Validation

The automated suite pins a modern MCP client to protocol `2026-07-28`, launches
`rundocket-mcp`, lists tools, and calls the shared inspection and planning core.
A separate legacy client performs the older initialization and calls the same
inspection core.

The Umkreis acceptance run additionally proved:

- `capabilities_list` detects Expo, local Expo MCP, Metro, a booted iOS
  simulator, and authenticated Expo/EAS CLIs;
- `expo_router_sitemap` returns five routes without collisions;
- `expo_take_screenshot` returns one JPEG image;
- `expo_collect_logs` completes through RunDocket;
- `expo_find_view` reaches the simulator, while successful element lookup
  remains unverified because Umkreis currently has no React Native `testID`.
- an approved Expo `start` plan launches Umkreis on a separate loopback port,
  returns a run ID and matching source evidence, and is cancelled without
  disturbing the existing port 8081 server.
