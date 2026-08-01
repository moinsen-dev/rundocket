import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ExecutionManager,
  planOperation,
  type OperationParameters,
} from "../src/index.js";

/**
 * The case that motivated the completion contract: `expo run:ios` finishes the
 * build and install, then keeps Metro in the foreground forever. Process exit
 * never arrives, so a caller waiting on exit waits for nothing.
 */
test("a launch run completes while its process keeps serving", async (t) => {
  const projectRoot = await createFakeExpoProject();
  const manager = new ExecutionManager();
  t.after(async () => {
    await manager.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
  });

  const plan = await planOperation(projectRoot, "launch", {
    parameters: { platform: "ios", deviceId: "SIM-UDID" },
  });
  assert.equal(plan.status, "VERIFIED");
  assert.equal(plan.execution.availability, "available");
  assert.deepEqual(plan.adapter.command?.args, [
    "run:ios",
    "--device",
    "SIM-UDID",
  ]);
  assert.equal(plan.adapter.command?.env.LC_ALL, "en_US.UTF-8");
  assert.equal(plan.adapter.signals?.completion, "installed");
  assert.equal(plan.adapter.signals?.completesOnExit, false);

  assert.ok(plan.planId);
  manager.rememberPlan(plan);
  const started = await manager.apply(plan.planId, true);

  const settled = await manager.awaitRun(started.runId, {
    timeoutMs: 20_000,
  });
  assert.equal(settled.outcome, "completed");
  assert.equal(settled.run.lifecycle.phase, "installed");
  assert.equal(settled.run.lifecycle.completion.reached, true);
  assert.equal(
    settled.run.lifecycle.completion.processOutlivesCompletion,
    true,
  );
  // The decisive property: the work is done and the process is still alive.
  assert.equal(settled.run.state, "running");
  assert.deepEqual(
    settled.run.lifecycle.milestones.map((milestone) => milestone.name),
    ["starting", "resolving", "compiling", "built", "installed"],
  );

  const terminal = await manager.cancel(started.runId);
  assert.ok(["cancelling", "cancelled"].includes(terminal.state));
});

test("a fatal build diagnostic ends the wait without a process exit", async (t) => {
  const projectRoot = await createFakeExpoProject({ failBuild: true });
  const manager = new ExecutionManager();
  t.after(async () => {
    await manager.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
  });

  const plan = await planOperation(projectRoot, "launch", {
    parameters: { platform: "ios" },
  });
  assert.ok(plan.planId);
  manager.rememberPlan(plan);
  const started = await manager.apply(plan.planId, true);

  const settled = await manager.awaitRun(started.runId, {
    timeoutMs: 20_000,
  });
  assert.equal(settled.outcome, "failed");
  assert.equal(settled.cause?.code, "XCODEBUILD_FAILED");
  assert.equal(settled.run.lifecycle.completion.reached, false);
  assert.ok(
    settled.run.diagnostics.some(
      (diagnostic) => diagnostic.code === "COMPILER_ERROR",
    ),
    "the compiler error line is retained as a structured diagnostic",
  );
});

/**
 * Verified against a real Expo iOS run: `--no-bundler` only suppresses a second
 * Metro instance, it does not make the command terminate.
 */
test("a build run suppresses the bundler but still outlives its completion", async (t) => {
  const projectRoot = await createFakeExpoProject();
  const manager = new ExecutionManager();
  t.after(async () => {
    await manager.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
  });

  const plan = await planOperation(projectRoot, "build", {
    parameters: { platform: "ios" },
  });
  assert.ok(plan.adapter.command?.args.includes("--no-bundler"));
  assert.equal(plan.adapter.signals?.completesOnExit, false);
  assert.ok(
    plan.diagnostics.some((note) => note.includes("--no-bundler")),
    "the plan discloses that the app needs a separate development server",
  );
  assert.ok(
    plan.diagnostics.some((note) =>
      note.includes("keeps running after the app is installed"),
    ),
    "the plan warns against waiting for process exit",
  );

  assert.ok(plan.planId);
  manager.rememberPlan(plan);
  const started = await manager.apply(plan.planId, true);

  const settled = await manager.awaitRun(started.runId, {
    timeoutMs: 20_000,
  });
  assert.equal(settled.outcome, "completed");
  assert.equal(settled.run.state, "running");
  assert.equal(settled.run.lifecycle.completion.reached, true);
  assert.equal(
    settled.run.lifecycle.completion.processOutlivesCompletion,
    true,
  );
});

test("a command that does exit reports completion from its exit code", async (t) => {
  const projectRoot = await createFakeExpoProject();
  const manager = new ExecutionManager();
  t.after(async () => {
    await manager.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
  });

  const plan = await planOperation(projectRoot, "test");
  assert.equal(plan.adapter.signals?.completesOnExit, true);
  assert.ok(plan.planId);
  manager.rememberPlan(plan);
  const started = await manager.apply(plan.planId, true);

  const settled = await manager.awaitRun(started.runId, {
    timeoutMs: 60_000,
  });
  assert.equal(settled.outcome, "completed");
  assert.equal(settled.run.state, "succeeded");
  assert.equal(settled.run.result.exitCode, 0);
  assert.equal(
    settled.run.lifecycle.completion.processOutlivesCompletion,
    false,
  );
});

test("waiting for an unreachable milestone times out instead of hanging", async (t) => {
  const projectRoot = await createFakeExpoProject({ stall: true });
  const manager = new ExecutionManager();
  t.after(async () => {
    await manager.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
  });

  const plan = await planOperation(projectRoot, "launch", {
    parameters: { platform: "ios" },
  });
  assert.ok(plan.planId);
  manager.rememberPlan(plan);
  const started = await manager.apply(plan.planId, true);

  const settled = await manager.awaitRun(started.runId, {
    until: "installed",
    timeoutMs: 1_500,
  });
  assert.equal(settled.outcome, "timeout");
  assert.equal(settled.run.state, "running");
  assert.ok(settled.waitedMs >= 1_400);
});

test("bounded output keeps the head where the first real error lives", async (t) => {
  const projectRoot = await createFakeExpoProject({ flood: true });
  const manager = new ExecutionManager();
  t.after(async () => {
    await manager.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
  });

  const plan = await planOperation(projectRoot, "build", {
    parameters: { platform: "ios" },
  });
  assert.ok(plan.planId);
  manager.rememberPlan(plan);
  const started = await manager.apply(plan.planId, true);
  const settled = await manager.awaitRun(started.runId, {
    until: "exit",
    timeoutMs: 30_000,
  });

  assert.equal(settled.run.output.truncated, true);
  assert.ok(settled.run.output.omittedBytes > 0);
  assert.ok(
    settled.run.output.stdout.includes("FIRST_CAUSE_MARKER"),
    "the original cause survives truncation",
  );
  assert.ok(
    settled.run.output.stdout.includes("LAST_LINE_MARKER"),
    "the end of the stream survives truncation",
  );
  assert.ok(settled.run.output.stdout.includes("bytes omitted"));
});

test("plan rejects an unsupported Expo platform before execution", async (t) => {
  const projectRoot = await createFakeExpoProject();
  t.after(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  const plan = await planOperation(projectRoot, "launch", {
    parameters: { platform: "web" } as OperationParameters,
  });
  assert.equal(plan.status, "NEEDS_INPUT");
  assert.deepEqual(plan.requiredInputs, ["platform"]);
  assert.equal(plan.adapter.command, null);
  assert.equal(plan.adapter.signals, null);
});

interface FakeProjectOptions {
  failBuild?: boolean;
  stall?: boolean;
  flood?: boolean;
}

async function createFakeExpoProject(
  options: FakeProjectOptions = {},
): Promise<string> {
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), "rundocket-signals-"),
  );
  const binDirectory = path.join(projectRoot, "node_modules", ".bin");
  const expoDirectory = path.join(projectRoot, "node_modules", "expo");
  await mkdir(binDirectory, { recursive: true });
  await mkdir(expoDirectory, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({
      name: "fake-expo-app",
      private: true,
      dependencies: { expo: "57.0.0" },
      scripts: {
        start: "expo start",
        test: "node -e \"console.log('Tests: 1 passed')\"",
      },
    }),
  );
  await writeFile(
    path.join(projectRoot, "app.json"),
    JSON.stringify({ expo: { name: "fake", slug: "fake" } }),
  );
  await writeFile(
    path.join(expoDirectory, "package.json"),
    JSON.stringify({ name: "expo", version: "57.0.0" }),
  );

  const fakeExpo = path.join(binDirectory, "expo");
  await writeFile(
    fakeExpo,
    `#!/usr/bin/env node
const args = process.argv.slice(2);
const mode = ${JSON.stringify(options)};
const say = (line) => process.stdout.write(line + "\\n");
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (args[0] === "whoami") { say("fake-user"); process.exit(0); }
if (args[0] === "--version") { say("57.0.0"); process.exit(0); }

async function main() {
  if (!String(args[0] || "").startsWith("run:")) { process.exit(0); }

  if (mode.flood) {
    say("FIRST_CAUSE_MARKER: the real reason this build failed");
    const filler = "x".repeat(200);
    for (let index = 0; index < 1200; index += 1) {
      say("noise " + index + " " + filler);
    }
    say("› Build Succeeded");
    say("› Installing /tmp/DerivedData/App.app");
    say("LAST_LINE_MARKER");
    return;
  }

  // Line shapes copied from a real \`expo run:ios\` run.
  say("› Using --device SIM-UDID");
  say("› Planning build");
  await wait(30);
  say("› Preparing Pods/React-Core-React-Core_privacy » ResourceBundle-Info.plist");
  await wait(30);
  say("› Executing react-native Pods/hermes-engine » [CP-User] [Hermes] Replace Hermes");

  if (mode.stall) {
    setInterval(() => {}, 1000);
    return;
  }

  await wait(30);
  if (mode.failBuild) {
    say("/tmp/MyApp/AppDelegate.mm:42:7: error: use of undeclared identifier");
    say("** BUILD FAILED **");
    setInterval(() => {}, 1000);
    return;
  }

  say("› Build Succeeded");
  say("");
  say("› 0 error(s), and 0 warning(s)");
  say("");
  // The bundler line really does arrive before the install line.
  say("Waiting on http://localhost:8081");
  await wait(30);
  say("› Installing /tmp/DerivedData/App.app");
  say("- Connecting to: iPhone 17 Pro Max");
  setInterval(() => {}, 1000);
}

process.on("SIGTERM", () => process.exit(0));
void main();
`,
  );
  await chmod(fakeExpo, 0o755);
  return projectRoot;
}
