# RunDocket MCP and Execution Kernel

## Value Proposition

RunDocket gives local AI coding agents one framework-neutral interface for
inspecting, preparing, and eventually executing app-development workflows.

The primary user is an AI agent working in an existing Xcode, Flutter, or Expo
workspace. Today that agent must discover the owning framework, know several
tool-specific command surfaces, interpret human-oriented output, and avoid
unsafe release or signing actions on its own.

**Core actions**

1. Inspect a workspace and report the owning projects.
2. Report executable capabilities and missing prerequisites without mutation.
3. Produce an immutable operation plan and, in later phases, apply approved
   local operations with structured evidence.

## Why an LLM Integration?

**Conversational win:** A developer can ask an agent to inspect, test, launch,
or diagnose an app without translating that intent into framework-specific
commands.

**LLM contribution:** The agent interprets intent, chooses among safe normalized
operations, resolves reported ambiguity with the user, and reasons over
evidence.

**What the LLM lacks:** Reliable workspace ownership, local toolchain state,
process control, device access, and trustworthy execution evidence. RunDocket
provides those through deterministic tools.

## Headless Interaction

RunDocket has no graphical view. The first interaction is a read-only workspace
inspection. Subsequent interactions list capabilities and create plans. Any
future mutation remains a separate explicit apply step.

The primary MCP transport is stdio so an agent can launch RunDocket as a local
subprocess. A persistent Streamable HTTP transport may be added later for
multi-client or daemon use cases.

## Product Context

- **Existing product:** TypeScript CLI with versioned workspace inspection.
- **Frameworks:** Native Apple/Xcode, Flutter, and Expo.
- **Local providers:** Framework CLIs plus optional Expo MCP or device-control
  providers.
- **Remote providers:** Expo MCP/EAS may be discovered, but remote builds,
  submissions, review replies, signing, and releases are not executable in this
  phase.
- **Authentication:** Readiness may report whether a CLI is authenticated, but
  credentials and tokens are never returned.
- **Constraints:** Local-first, model-neutral, read-only detection, stable JSON,
  explicit project selection, and evidence-backed claims.

## MCP Contract

The initial headless MCP server exposes:

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

All tools delegate to the same core modules used by the CLI. Expo provider
tools remain unavailable unless the project, package, running development
server, and requested local capability are verified.

The initial execution tools apply only verified Expo development-server start
plans. Build, test, app launch, and remote operations remain unavailable.

## Safety

- Read-only operations are available by default.
- Plans are immutable and include a deterministic hash.
- Ambiguous workspaces stop with `NEEDS_INPUT`.
- Destructive, signing, upload, store, and release operations remain
  default-deny.
- Tool responses never expose authentication tokens or full process
  environments.
- Screenshots and logs are evidence operations but may contain app data; callers
  must use non-production test data.

## Acceptance

1. The CLI can inspect and diagnose the Umkreis Expo workspace.
2. An MCP client can launch RunDocket over stdio and call the three core
   read-only tools.
3. RunDocket can discover a running Expo development server and invoke local
   Expo MCP for the router sitemap and a simulator screenshot.
4. Every result is structured, versioned, and explicit about unavailable or
   unverified capabilities.
5. `npm run check` passes without claiming build, test, launch, signing, upload,
   or release support.

## Validation Status

- Core CLI and MCP inspection: verified.
- Doctor and deterministic operation plans: verified.
- Modern MCP 2026-07-28 stdio handshake: verified.
- Umkreis Expo routes, screenshot, and log collection through RunDocket:
  verified.
- Approved Umkreis Expo development-server start, status, cancellation, and
  freshness-aware evidence through RunDocket: verified on an isolated port.
- Expo view provider connection: verified; successful view lookup remains
  unverified because the current Umkreis UI has no React Native `testID`.
- Build, test, app launch, cross-session durable evidence, EAS mutation,
  signing, upload, and release: not verified.
