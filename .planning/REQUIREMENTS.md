# Requirements: RunDocket

**Defined:** 2026-07-31
**Core Value:** An AI coding agent can build, test, and launch an app through
one reliable machine contract without framework-specific command knowledge.

## v1 Requirements

### Discovery

- [x] **DISC-01**: An agent can inspect a workspace without changing files or toolchain state.
- [x] **DISC-02**: An agent can detect native Apple projects and workspaces from explicit markers.
- [x] **DISC-03**: An agent can detect Flutter apps from Flutter SDK metadata.
- [x] **DISC-04**: An agent can detect Expo apps and distinguish managed from prebuilt native layouts.
- [x] **DISC-05**: An agent receives primary and embedded project relationships for hybrid repositories.
- [x] **DISC-06**: An agent receives `NEEDS_INPUT` with candidate IDs when a workspace contains multiple primary apps.

### Contract

- [x] **CONT-01**: An agent receives a versioned JSON document for every inspection.
- [x] **CONT-02**: An agent receives canonical status and stable exit-code semantics.
- [x] **CONT-03**: Every detected project includes workspace-relative evidence paths.
- [x] **CONT-04**: Framework adapters expose capabilities through one normalized vocabulary.

### Execution

- [x] **EXEC-01**: An agent can probe local prerequisites without changing the workspace.
- [x] **EXEC-02**: An agent can create an immutable plan for a build, test, launch, or log operation.
- [ ] **EXEC-03**: An agent can apply an approved plan through the selected framework adapter.
- [ ] **EXEC-04**: An agent receives structured logs, artifacts, duration, commands, and verification results.
- [x] **EXEC-05**: Evidence becomes stale when relevant source or plan inputs change.

### Adapters

- [ ] **ADPT-01**: A native Apple project can be built, tested, launched, and observed through the normalized contract.
- [ ] **ADPT-02**: A Flutter project can be built, tested, launched, and observed through the normalized contract.
- [ ] **ADPT-03**: An Expo project can be built, tested, launched, and observed through the normalized contract.

### Safety

- [x] **SAFE-01**: Ambiguous targets stop with `NEEDS_INPUT` rather than being guessed.
- [ ] **SAFE-02**: Destructive operations stop with `NEEDS_APPROVAL`.
- [x] **SAFE-03**: Signing, upload, and release operations are unavailable until separately authorized and evidenced.

### Integration

- [ ] **INTG-01**: A coding agent can use the complete v1 workflow through the CLI and JSON contract.
- [ ] **INTG-02**: MCP and Agent Skill integrations remain thin wrappers over the same core contract.
- [ ] **INTG-03**: The same high-level agent instruction works against native Apple, Flutter, and Expo acceptance fixtures.

## v2 Requirements

### Frameworks

- **FRAM-01**: Detect and execute bare React Native projects without Expo.
- **FRAM-02**: Detect and execute native Android/Gradle apps.
- **FRAM-03**: Allow third parties to register additional framework adapters.

### Operations

- **OPER-01**: Coordinate remote build providers through separately approved adapters.
- **OPER-02**: Support performance and accessibility evidence workflows.

## Out of Scope

| Feature | Reason |
|---------|--------|
| GUI or TUI | The primary v1 consumer is a headless agent |
| Autonomous App Store or Play Store publication | Externally binding action requires a separate release contract |
| General-purpose coding agent | RunDocket executes app workflows; it does not generate product code |
| Cloud-hosted control plane | Local-first execution proves the contract with lower risk |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DISC-01..06 | Phase 1 | Complete |
| CONT-01..04 | Phase 1 | Complete |
| EXEC-01..02 | Phase 2 | Complete |
| EXEC-03..04 | Phase 2 | Pending |
| EXEC-05 | Phase 2 | Complete |
| SAFE-01, SAFE-03 | Phase 2 | Complete |
| SAFE-02 | Phase 2 | Pending |
| ADPT-01 | Phase 3 | Pending |
| ADPT-02..03 | Phase 4 | Pending |
| INTG-01..03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-07-31*
*Last updated: 2026-07-31 after Phase 1 verification*
