# RunDocket

## What This Is

RunDocket is a headless, AI-first execution layer for app development. It
discovers an app workspace, chooses the framework that owns each app, exposes a
normalized capability contract, and eventually executes approved workflows with
verifiable evidence.

The initial framework scope is native Apple/Xcode, Flutter, and Expo.

## Core Value

An AI coding agent can build, test, and launch an app through one reliable
machine contract without needing framework-specific command knowledge.

## Requirements

### Validated

- ✓ A workspace can be inspected without modification — Phase 1
- ✓ Native Apple, Flutter, and Expo roots are detected from explicit markers — Phase 1
- ✓ Flutter and Expo retain ownership of embedded Xcode projects — Phase 1
- ✓ Inspection returns versioned JSON, canonical statuses, stable exit codes, and evidence — Phase 1
- ✓ A portable Agent Skill delegates to the shared CLI/MCP contract and is
  discoverable through `npx skills` — Phase 5
- ✓ A long-running command reports when its work is done rather than when its
  process exits, and waiting is one call instead of a polling loop — Phase 2

### Active

- [ ] Expose normalized toolchain capabilities and prerequisite state.
- [ ] Plan, execute, and verify build, test, launch, and log workflows.
- [ ] Decide whether managed runs survive the agent session.
- [ ] Keep destructive, signing, upload, and release actions default-deny.
- [ ] Remain independent of a particular model, agent runtime, or framework.

### Out of Scope

- GUI or TUI — the primary consumer is a headless AI agent.
- Autonomous store publication — external release remains explicitly approved.
- Source-code generation — RunDocket executes development workflows rather than
  replacing the coding agent.
- Cloud execution service — v1 is local-first.
- Frameworks beyond native Apple, Flutter, and Expo — add after the contract is
  proven across the initial three adapters.

## Context

The concept began as a possible headless companion to an Xcode-oriented tool.
The product boundary moved upward: Xcode is now one adapter behind a
framework-neutral execution contract. Expo and Flutter can contain generated
native projects, so repository detection must model ownership rather than stop
at the first `.xcodeproj`.

RunDocket is intended to be callable directly as a CLI and indirectly through
thin MCP or Agent Skill integrations.

## Constraints

- **Safety**: Inspection is read-only; destructive or externally binding actions
  require an explicit plan and approval.
- **Evidence**: A workflow is only verified by fresh machine-readable evidence.
- **Portability**: The core contract cannot encode one AI vendor or framework.
- **Compatibility**: The bootstrap runs on Node.js 22 or newer.
- **Publication**: The source is published under the MIT License; npm package
  publication remains outside the bootstrap scope.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Use RunDocket as the independent name | Avoids coupling the product identity to Xcode or one agent | ✓ Good |
| Model a project graph rather than one project type | Expo and Flutter may own embedded native projects | ✓ Good |
| Make CLI and JSON the source of truth | Headless agents need a stable, portable contract | ✓ Good |
| Use adapters for framework-specific behavior | Keeps agent intents uniform while preserving native toolchains | ✓ Good |
| Bootstrap with TypeScript 7 on Node 22 | Fast iteration, strong contracts, and a small official MCP runtime surface | ✓ Good |
| Use stdio MCP before a local HTTP daemon | Lets the agent own process lifecycle without ports or local auth | ✓ Good |
| Treat Expo MCP as a provider, not the public contract | Preserves framework-neutral tools and normalizes provider failures | ✓ Good |
| Publish a model-neutral Agent Skill as a thin integration | Makes the verified workflow installable without duplicating execution logic | ✓ Good |
| Separate the work lifecycle from the process lifecycle | Development commands finish their work long before they exit, so process exit is not a completion signal | ✓ Good |
| Make waiting a server-side call instead of agent-side polling | An agent cannot reliably judge from raw output whether a build is still running | ✓ Good |
| Derive milestone patterns from real command output, not from documentation | The first pass assumed `--no-bundler` terminates and mismatched the install line; the real run disproved both | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition**:
1. Move verified requirements to Validated with phase evidence.
2. Move invalidated requirements to Out of Scope with a reason.
3. Add newly discovered requirements to Active.
4. Record decisions and update outcomes.
5. Confirm that What This Is and Core Value still match the product.

**After each milestone**:
1. Review every requirement and scope boundary.
2. Recheck the Core Value.
3. Audit evidence and unresolved risks.
4. Update the current repository context.

---
*Last updated: 2026-07-31 during Phase 2 and Agent Skill integration*
