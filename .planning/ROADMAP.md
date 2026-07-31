# Roadmap: RunDocket

## Phase 1: Workspace discovery contract

**Goal:** A headless agent can safely identify supported app projects and their
ownership relationships through one versioned JSON response.

**Mode:** mvp

**Requirements:** DISC-01..06, CONT-01..04

**Success Criteria:**
1. Native Apple, Flutter, Expo, hybrid, monorepo, and unsupported fixtures have deterministic tests.
2. Expo and Flutter own their embedded Xcode projects.
3. Single-app, ambiguous, unsupported, and failed inspections have documented statuses and exit codes.
4. `npm run check` passes from a clean install.

## Phase 2: Plans, readiness, and evidence kernel

**Goal:** Agent intents become immutable, safety-classified plans with
prerequisite probes and evidence lifecycle rules.

**Mode:** mvp

**Requirements:** EXEC-01..05, SAFE-01..03

**Success Criteria:**
1. Build, test, launch, and logs can be planned without execution.
2. Plans bind the selected project, inputs, toolchain, and worktree fingerprint.
3. Destructive and release-class operations stop before execution.
4. Applied plans produce fresh, versioned evidence bundles.

## Phase 3: Native Apple adapter

**Goal:** RunDocket can execute the normalized local workflow for a native Apple
reference app.

**Mode:** mvp

**Requirements:** ADPT-01

**Success Criteria:**
1. Readiness identifies Xcode, schemes, destinations, and missing prerequisites.
2. Build and test return structured results and artifacts.
3. Simulator launch and log capture are verified on one frozen build.
4. No signing, device, or release claim is inferred from simulator evidence.

## Phase 4: Flutter and Expo adapters

**Goal:** The same normalized workflow works for Flutter and Expo reference apps,
including their native Apple boundaries.

**Mode:** mvp

**Requirements:** ADPT-02, ADPT-03

**Success Criteria:**
1. Framework-owned commands remain primary for normal workflows.
2. Native diagnosis can route to the embedded Xcode project without changing ownership.
3. Managed Expo projects report when prebuild or cloud capabilities are required.
4. Build, test, launch, and log evidence uses the same contract as the Apple adapter.

## Phase 5: Agent integrations and cross-framework acceptance

**Goal:** Coding agents can discover and use RunDocket automatically through
portable integration surfaces.

**Mode:** mvp

**Requirements:** INTG-01..03

**Success Criteria:**
1. CLI help and JSON schemas are sufficient for direct agent operation.
2. A thin MCP server and Agent Skill expose the same core operations.
3. One framework-neutral instruction completes the acceptance workflow on all three reference apps.
4. Missing integration capabilities remain visibly unverified.

## Progress

| Phase | Status | Progress |
|-------|--------|----------|
| 1. Workspace discovery contract | Complete | 100% |
| 2. Plans, readiness, and evidence kernel | In progress | 70% |
| 3. Native Apple adapter | Pending | 0% |
| 4. Flutter and Expo adapters | Pending | 0% |
| 5. Agent integrations and acceptance | In progress | 45% |

## Current evidence

- Doctor and immutable planning contracts are implemented and covered by the
  bootstrap verification gate.
- The headless stdio MCP server supports modern MCP 2026-07-28 clients and
  legacy compatibility.
- A real Umkreis acceptance run reached local Expo MCP through RunDocket for
  routes, screenshot, logs, and a negative view lookup.
- A second real Umkreis acceptance run planned, approved, started, observed,
  evidenced, and cancelled an isolated Expo server without disturbing the
  existing development server.
- Cross-framework build/test/launch execution, durable cross-session runs, and
  successful `testID` view lookup remain open gates.
