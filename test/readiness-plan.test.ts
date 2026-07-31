import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import {
  doctorWorkspace,
  planOperation,
  type DoctorResult,
  type OperationPlan,
} from "../src/index.js";

const FIXTURES = path.join(process.cwd(), "test", "fixtures");

test("doctor exposes the safe core and explicit Expo provider state", async () => {
  const result = await doctorWorkspace(
    path.join(FIXTURES, "expo-managed"),
    { timeoutMs: 500 },
  );

  assert.equal(result.schemaVersion, "rundocket.doctor.v1");
  assert.equal(result.status, "VERIFIED");
  assert.equal(result.selectedProject?.id, "expo:.");

  for (const capabilityName of ["inspect", "doctor", "plan", "mcp"]) {
    assert.equal(
      result.capabilities.find(
        (capability) => capability.name === capabilityName,
      )?.availability,
      "available",
    );
  }

  const expoMcp = result.providers.find(
    (provider) => provider.id === "expo-mcp-local",
  );
  assert.ok(expoMcp);
  assert.equal(
    expoMcp.capabilities.find(
      (capability) => capability.name === "expo_tap",
    )?.availability,
    "blocked",
  );
  assert.equal(JSON.stringify(result).includes("Bearer"), false);
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("doctor preserves ambiguity instead of selecting a monorepo app", async () => {
  const result = await doctorWorkspace(path.join(FIXTURES, "monorepo"), {
    timeoutMs: 500,
  });

  assert.equal(result.status, "NEEDS_INPUT");
  assert.equal(result.selectedProject, null);
  assert.ok(
    result.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "PROJECT_SELECTION_REQUIRED",
    ),
  );
});

test("plans are deterministic and source-bound", async () => {
  const workspace = path.join(FIXTURES, "flutter-ios");
  const first = await planOperation(workspace, "test");
  const second = await planOperation(workspace, "test");

  assert.equal(first.schemaVersion, "rundocket.plan.v1");
  assert.equal(first.status, "VERIFIED");
  assert.match(first.planId ?? "", /^plan_[a-f0-9]{32}$/);
  assert.equal(first.planId, second.planId);
  assert.equal(
    first.sourceFingerprint?.value,
    second.sourceFingerprint?.value,
  );
  assert.equal(first.execution.availability, "planned");
  assert.equal(first.adapter.command?.executable, "flutter");
  assert.deepEqual(first.adapter.command?.args, ["test"]);
});

test("plan reports missing operation inputs without execution", async () => {
  const workspace = path.join(FIXTURES, "expo-managed");
  const incomplete = await planOperation(workspace, "build");
  const ios = await planOperation(workspace, "build", {
    parameters: { platform: "ios" },
  });

  assert.equal(incomplete.status, "NEEDS_INPUT");
  assert.deepEqual(incomplete.requiredInputs, ["platform"]);
  assert.equal(incomplete.execution.availability, "needs_input");
  assert.equal(ios.status, "VERIFIED");
  assert.equal(ios.execution.availability, "planned");
  assert.notEqual(incomplete.planId, ios.planId);
});

test("doctor and plan CLI commands emit versioned JSON", () => {
  const cliPath = path.join(process.cwd(), "dist", "src", "cli.js");
  const fixturePath = path.join(FIXTURES, "flutter-ios");

  const doctor = spawnSync(
    process.execPath,
    [cliPath, "doctor", fixturePath, "--json"],
    { encoding: "utf8" },
  );
  assert.equal(doctor.status, 0, doctor.stderr);
  const doctorResult = JSON.parse(doctor.stdout) as DoctorResult;
  assert.equal(doctorResult.schemaVersion, "rundocket.doctor.v1");

  const plan = spawnSync(
    process.execPath,
    [cliPath, "plan", "test", fixturePath, "--json"],
    { encoding: "utf8" },
  );
  assert.equal(plan.status, 0, plan.stderr);
  const planResult = JSON.parse(plan.stdout) as OperationPlan;
  assert.equal(planResult.schemaVersion, "rundocket.plan.v1");
  assert.equal(planResult.operation, "test");
});
