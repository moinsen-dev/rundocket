import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import {
  EXIT_CODES,
  inspectWorkspace,
  type InspectResult,
} from "../src/index.js";

const FIXTURES = path.join(process.cwd(), "test", "fixtures");

test("detects a managed Expo app from package and app config evidence", async () => {
  const result = await inspectWorkspace(path.join(FIXTURES, "expo-managed"));

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.selection.selectedProjectId, "expo:.");
  assert.equal(result.projects.length, 1);

  const project = result.projects[0];
  assert.equal(project?.kind, "expo");
  assert.equal(project?.role, "primary");
  assert.equal(project?.mode, "managed");
  assert.equal(project?.confidence, "high");
  assert.deepEqual(project?.platforms, ["ios", "android"]);
  assert.deepEqual(
    project?.evidence.map((evidence) => evidence.path),
    ["package.json", "app.json"],
  );
  assert.equal(
    project?.capabilities.find((capability) => capability.name === "inspect")
      ?.availability,
    "available",
  );
  assert.equal(
    project?.capabilities.find((capability) => capability.name === "build")
      ?.availability,
    "planned",
  );
});

test("keeps a prebuilt Expo app primary and its Xcode project embedded", async () => {
  const result = await inspectWorkspace(path.join(FIXTURES, "expo-prebuilt"));

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.selection.selectedProjectId, "expo:.");
  assert.equal(result.projects.length, 2);

  const expo = result.projects.find((project) => project.kind === "expo");
  const xcode = result.projects.find((project) => project.kind === "xcode");

  assert.equal(expo?.mode, "prebuilt");
  assert.equal(expo?.role, "primary");
  assert.equal(xcode?.role, "embedded");
  assert.equal(xcode?.ownerProjectId, "expo:.");
  assert.deepEqual(xcode?.platforms, ["ios"]);
});

test("keeps a Flutter app primary and its iOS Xcode project embedded", async () => {
  const result = await inspectWorkspace(path.join(FIXTURES, "flutter-ios"));

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.selection.selectedProjectId, "flutter:.");
  assert.equal(result.projects.length, 2);

  const flutter = result.projects.find((project) => project.kind === "flutter");
  const xcode = result.projects.find((project) => project.kind === "xcode");

  assert.equal(flutter?.role, "primary");
  assert.equal(flutter?.mode, "app");
  assert.deepEqual(flutter?.platforms, ["ios"]);
  assert.equal(xcode?.role, "embedded");
  assert.equal(xcode?.ownerProjectId, "flutter:.");
});

test("detects an Apple workspace and project as one native app root", async () => {
  const result = await inspectWorkspace(path.join(FIXTURES, "native-xcode"));

  assert.equal(result.status, "VERIFIED");
  assert.equal(result.selection.selectedProjectId, "xcode:.");
  assert.equal(result.projects.length, 1);

  const project = result.projects[0];
  assert.equal(project?.kind, "xcode");
  assert.equal(project?.mode, "workspace");
  assert.deepEqual(project?.platforms, ["ios"]);
  assert.deepEqual(
    project?.evidence.map((evidence) => evidence.marker),
    ["xcode-project", "xcode-workspace"],
  );
});

test("returns NEEDS_INPUT for a monorepo with multiple primary apps", async () => {
  const result = await inspectWorkspace(path.join(FIXTURES, "monorepo"));

  assert.equal(result.status, "NEEDS_INPUT");
  assert.equal(result.selection.status, "needs_input");
  assert.equal(result.selection.selectedProjectId, null);
  assert.deepEqual(result.selection.candidateProjectIds, [
    "expo:apps/expo",
    "flutter:apps/flutter",
  ]);
});

test("returns UNVERIFIED when no supported project markers exist", async () => {
  const result = await inspectWorkspace(path.join(FIXTURES, "unsupported"));

  assert.equal(result.status, "UNVERIFIED");
  assert.equal(result.selection.status, "unsupported");
  assert.deepEqual(result.projects, []);
});

test("CLI emits the versioned JSON contract and stable ambiguity exit code", () => {
  const cliPath = path.join(process.cwd(), "dist", "src", "cli.js");
  const fixturePath = path.join(FIXTURES, "monorepo");
  const completed = spawnSync(
    process.execPath,
    [cliPath, "inspect", fixturePath, "--json"],
    { encoding: "utf8" },
  );

  assert.equal(completed.status, EXIT_CODES.NEEDS_INPUT);
  assert.equal(completed.stderr, "");

  const result = JSON.parse(completed.stdout) as InspectResult;
  assert.equal(result.schemaVersion, "rundocket.inspect.v1");
  assert.equal(result.status, "NEEDS_INPUT");
});

test("CLI returns a structured failure for an invalid workspace", () => {
  const cliPath = path.join(process.cwd(), "dist", "src", "cli.js");
  const completed = spawnSync(
    process.execPath,
    [cliPath, "inspect", path.join(FIXTURES, "missing"), "--json"],
    { encoding: "utf8" },
  );

  assert.equal(completed.status, EXIT_CODES.FAILED);
  assert.equal(completed.stdout, "");

  const failure = JSON.parse(completed.stderr) as {
    schemaVersion: string;
    status: string;
    error: { code: string };
  };
  assert.equal(failure.schemaVersion, "rundocket.error.v1");
  assert.equal(failure.status, "FAILED");
  assert.equal(failure.error.code, "INSPECTION_FAILED");
});
