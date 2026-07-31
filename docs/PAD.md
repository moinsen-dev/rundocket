# RunDocket PAD

## Product

RunDocket is a headless execution layer that helps AI coding agents develop apps
without learning a different command surface for every framework.

## Problem

App-development agents currently need framework-specific knowledge, parse
human-oriented terminal output, and guess which native project is authoritative.
That is especially unreliable for Flutter and Expo repositories that also
contain generated Xcode projects.

## Primary user

An AI coding agent operating in a local app repository.

## Core outcome

Given an app workspace and an intent such as build, test, or launch, the agent
receives one stable machine contract, the correct framework adapter, and
verifiable execution evidence.

## Core loop

1. Inspect the workspace without modifying it.
2. Identify primary apps, embedded platform projects, and ambiguity.
3. Expose normalized capabilities and missing prerequisites.
4. Produce an immutable execution plan.
5. Apply an approved plan through the selected adapter.
6. Verify the outcome and return evidence artifacts.

## Main CLI surface

```text
$ rundocket inspect . --json

status          VERIFIED
workspace       /repo/my-app
selected        expo:.
mode            prebuilt
platforms       ios, android
embedded        xcode:ios
capabilities    inspect, doctor, build, test, launch, logs
evidence        package.json, app.json, ios/*.xcworkspace
```

## v1 scope

- Native Apple, Flutter, and Expo project discovery.
- Primary-versus-embedded project graph.
- Versioned JSON contracts and stable statuses.
- Readiness probing for local toolchains.
- Normalized build, test, launch, and log workflows.
- Execution plans, safety gates, and evidence bundles.
- Thin CLI-first integrations for skills and MCP clients.

## Exclusions

- GUI or TUI.
- Autonomous App Store or Play Store publication.
- Autonomous signing or credential changes.
- Source-code generation as a product feature.
- Cloud execution service.

## Product acceptance

The same agent instruction — “build, test, and launch this app” — succeeds
against native Apple, Flutter, and Expo reference projects without the agent
issuing framework-specific commands directly.
