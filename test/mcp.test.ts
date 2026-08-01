import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const FIXTURES = path.join(process.cwd(), "test", "fixtures");

test("modern MCP client discovers tools and calls the shared core", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), "dist", "src", "mcp-cli.js")],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const client = new Client(
    { name: "rundocket-test", version: "0.0.1" },
    {
      versionNegotiation: {
        mode: { pin: "2026-07-28" },
      },
    },
  );

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [
      "capabilities_list",
      "evidence_get",
      "expo_collect_logs",
      "expo_find_view",
      "expo_router_sitemap",
      "expo_take_screenshot",
      "operation_apply",
      "operation_await",
      "operation_cancel",
      "operation_plan",
      "operation_status",
      "workspace_inspect",
    ]);

    const inspection = await client.callTool({
      name: "workspace_inspect",
      arguments: {
        workspacePath: path.join(FIXTURES, "expo-managed"),
      },
    });
    assert.equal(inspection.isError, undefined);
    assert.equal(
      valueAt(inspection.structuredContent, "schemaVersion"),
      "rundocket.inspect.v1",
    );
    assert.equal(
      valueAt(inspection.structuredContent, "status"),
      "VERIFIED",
    );

    const plan = await client.callTool({
      name: "operation_plan",
      arguments: {
        workspacePath: path.join(FIXTURES, "flutter-ios"),
        operation: "test",
      },
    });
    assert.equal(plan.isError, undefined);
    assert.equal(
      valueAt(plan.structuredContent, "schemaVersion"),
      "rundocket.plan.v2",
    );
    assert.match(
      String(valueAt(plan.structuredContent, "planId")),
      /^plan_[a-f0-9]{32}$/,
    );
  } finally {
    await client.close().catch(() => undefined);
  }

  assert.equal(stderr, "");
});

test("legacy MCP client can call the same inspection core", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), "dist", "src", "mcp-cli.js")],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const client = new Client({
    name: "rundocket-legacy-test",
    version: "0.0.1",
  });

  try {
    await client.connect(transport);
    const inspection = await client.callTool({
      name: "workspace_inspect",
      arguments: {
        workspacePath: path.join(FIXTURES, "native-xcode"),
      },
    });
    assert.equal(inspection.isError, undefined);
    assert.equal(
      valueAt(inspection.structuredContent, "schemaVersion"),
      "rundocket.inspect.v1",
    );
    assert.equal(
      valueAt(inspection.structuredContent, "status"),
      "VERIFIED",
    );
  } finally {
    await client.close().catch(() => undefined);
  }

  assert.equal(stderr, "");
});

function valueAt(value: unknown, key: string): unknown {
  assert.ok(value !== null && typeof value === "object");
  return (value as Record<string, unknown>)[key];
}
