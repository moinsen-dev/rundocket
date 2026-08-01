import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ExecutionError,
  ExecutionManager,
  planOperation,
} from "../src/index.js";

test("approved Expo start produces a managed cancellable run with evidence", async (t) => {
  const projectRoot = await createFakeExpoProject();
  const port = await availablePort();
  const manager = new ExecutionManager();
  t.after(async () => {
    await manager.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
  });

  const plan = await planOperation(projectRoot, "start", {
    parameters: { port },
  });
  assert.equal(plan.status, "VERIFIED");
  assert.equal(plan.execution.availability, "available");
  assert.equal(plan.execution.approvalRequired, true);
  assert.ok(plan.planId);
  manager.rememberPlan(plan);

  await assert.rejects(
    manager.apply(plan.planId, false),
    (error: unknown) =>
      error instanceof ExecutionError &&
      error.code === "NEEDS_APPROVAL",
  );

  const started = await manager.apply(plan.planId, true);
  assert.equal(started.state, "running");
  assert.match(started.runId, /^run_[0-9a-f-]{36}$/);
  assert.equal(started.planId, plan.planId);

  const cancelled = await manager.cancel(started.runId);
  assert.ok(["cancelling", "cancelled"].includes(cancelled.state));
  const terminal = await waitForTerminal(manager, started.runId);
  assert.equal(terminal.state, "cancelled");
  assert.equal(terminal.result.cancellationRequested, true);
  assert.equal(
    terminal.evidence.sourceFingerprintAtApply,
    terminal.evidence.sourceFingerprintAtPlan,
  );

  const evidence = await manager.evidence(started.runId);
  assert.equal(evidence.schemaVersion, "rundocket.evidence.v2");
  assert.equal(evidence.plan.planId, plan.planId);
  assert.equal(evidence.run.runId, started.runId);
  assert.equal(evidence.freshness.status, "fresh");

  await writeFile(
    path.join(projectRoot, "app.json"),
    JSON.stringify({ expo: { name: "after-run", slug: "after-run" } }),
  );
  const staleEvidence = await manager.evidence(started.runId);
  assert.equal(staleEvidence.freshness.status, "stale");
});

test("apply rejects a plan after source inputs change", async (t) => {
  const projectRoot = await createFakeExpoProject();
  const port = await availablePort();
  const manager = new ExecutionManager();
  t.after(async () => {
    await manager.shutdown();
    await rm(projectRoot, { recursive: true, force: true });
  });

  const plan = await planOperation(projectRoot, "start", {
    parameters: { port },
  });
  assert.ok(plan.planId);
  manager.rememberPlan(plan);

  await writeFile(
    path.join(projectRoot, "app.json"),
    JSON.stringify({ expo: { name: "changed", slug: "changed" } }),
  );

  await assert.rejects(
    manager.apply(plan.planId, true),
    (error: unknown) =>
      error instanceof ExecutionError && error.code === "STALE_PLAN",
  );
});

async function createFakeExpoProject(): Promise<string> {
  const projectRoot = await mkdtemp(
    path.join(os.tmpdir(), "rundocket-execution-"),
  );
  const binDirectory = path.join(projectRoot, "node_modules", ".bin");
  const expoDirectory = path.join(
    projectRoot,
    "node_modules",
    "expo",
  );
  await mkdir(binDirectory, { recursive: true });
  await mkdir(expoDirectory, { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    JSON.stringify({
      name: "fake-expo-app",
      private: true,
      dependencies: { expo: "57.0.0" },
      scripts: { start: "expo start" },
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
if (args[0] === "whoami") {
  console.log("fake-user");
  process.exit(0);
}
if (args[0] === "--version") {
  console.log("57.0.0");
  process.exit(0);
}
if (args[0] === "start") {
  console.log("fake Expo development server started");
  process.on("SIGTERM", () => process.exit(0));
  setInterval(() => {}, 1000);
}
`,
  );
  await chmod(fakeExpo, 0o755);
  return projectRoot;
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Failed to allocate a loopback port."));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function waitForTerminal(
  manager: ExecutionManager,
  runId: string,
): Promise<ReturnType<ExecutionManager["status"]>> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const status = manager.status(runId);
    if (["succeeded", "failed", "cancelled"].includes(status.state)) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Run did not reach a terminal state.");
}
