import {
  McpServer,
  type CallToolResult,
} from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { doctorWorkspace } from "./doctor.js";
import { inspectWorkspace } from "./discovery.js";
import {
  ExecutionError,
  ExecutionManager,
} from "./execution.js";
import { planOperation } from "./plan.js";
import {
  collectExpoLogs,
  findExpoView,
  getExpoRouterSitemap,
  takeExpoScreenshot,
  type ExpoToolResult,
} from "./providers/expo-mcp.js";
import { RUNDOCKET_VERSION } from "./version.js";

const jsonObjectSchema = z.record(z.string(), z.unknown());
const workspaceInputSchema = z.object({
  workspacePath: z.string().min(1).describe("Absolute or relative app workspace path."),
  maxDepth: z.number().int().min(0).max(12).optional(),
  projectId: z.string().min(1).optional(),
});
const expoWorkspaceInputSchema = workspaceInputSchema.extend({
  expoDevServerUrl: z
    .string()
    .min(1)
    .optional()
    .describe("Optional loopback Expo development-server URL."),
});
const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createRunDocketMcpServer(): McpServer {
  const execution = new ExecutionManager();
  const server = new McpServer({
    name: "rundocket",
    version: RUNDOCKET_VERSION,
  });
  server.server.onclose = () => {
    void execution.shutdown();
  };

  server.registerTool(
    "workspace_inspect",
    {
      title: "Inspect app workspace",
      description:
        "Detect Xcode, Flutter, and Expo projects and their ownership relationships without modifying the workspace.",
      inputSchema: workspaceInputSchema.pick({
        workspacePath: true,
        maxDepth: true,
      }),
      outputSchema: jsonObjectSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ workspacePath, maxDepth }) =>
      safeStructuredResult(async () => {
        const result = await inspectWorkspace(
          workspacePath,
          maxDepth === undefined ? {} : { maxDepth },
        );
        return structuredJson(result);
      }),
  );

  server.registerTool(
    "capabilities_list",
    {
      title: "List verified app capabilities",
      description:
        "Probe local framework tools, authentication state, development servers, devices, and safety gates without changing the workspace.",
      inputSchema: expoWorkspaceInputSchema,
      outputSchema: jsonObjectSchema,
      annotations: readOnlyAnnotations,
    },
    async ({
      workspacePath,
      maxDepth,
      projectId,
      expoDevServerUrl,
    }) =>
      safeStructuredResult(async () => {
        const result = await doctorWorkspace(
          workspacePath,
          compact({
            maxDepth,
            projectId,
            expoDevServerUrl,
          }),
        );
        return structuredJson(result);
      }),
  );

  server.registerTool(
    "operation_plan",
    {
      title: "Create immutable app operation plan",
      description:
        "Create a deterministic, source-bound plan for start, build, test, launch, or logs without executing it.",
      inputSchema: expoWorkspaceInputSchema.extend({
        operation: z.enum([
          "start",
          "build",
          "test",
          "launch",
          "logs",
        ]),
        parameters: z
          .object({
            platform: z.string().min(1).optional(),
            scheme: z.string().min(1).optional(),
            configuration: z.string().min(1).optional(),
            destination: z.string().min(1).optional(),
            deviceId: z.string().min(1).optional(),
            sources: z.array(z.string().min(1)).optional(),
            port: z.number().int().min(1024).max(65_535).optional(),
          })
          .optional(),
      }),
      outputSchema: jsonObjectSchema,
      annotations: readOnlyAnnotations,
    },
    async ({
      workspacePath,
      operation,
      maxDepth,
      projectId,
      expoDevServerUrl,
      parameters,
    }) =>
      safeStructuredResult(async () => {
        const result = await planOperation(
          workspacePath,
          operation,
          compact({
            maxDepth,
            projectId,
            expoDevServerUrl,
            parameters,
          }),
        );
        execution.rememberPlan(result);
        return structuredJson(result);
      }),
  );

  server.registerTool(
    "operation_apply",
    {
      title: "Apply approved operation plan",
      description:
        "Apply a plan registered in this MCP session. Currently limited to verified Expo development-server start.",
      inputSchema: z.object({
        planId: z.string().regex(/^plan_[a-f0-9]{32}$/),
        approved: z.boolean().describe("Explicit approval for local mutation."),
      }),
      outputSchema: jsonObjectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ planId, approved }) =>
      safeStructuredResult(async () =>
        structuredJson(await execution.apply(planId, approved)),
      ),
  );

  server.registerTool(
    "operation_status",
    {
      title: "Read operation status",
      description:
        "Read bounded output, process state, exit information, and source evidence for a managed run.",
      inputSchema: z.object({
        runId: z.string().regex(/^run_[0-9a-f-]{36}$/),
      }),
      outputSchema: jsonObjectSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ runId }) =>
      safeStructuredResult(async () =>
        structuredJson(execution.status(runId)),
      ),
  );

  server.registerTool(
    "operation_cancel",
    {
      title: "Cancel managed operation",
      description:
        "Stop the process group for a RunDocket-managed run. The operation is idempotent for terminal runs.",
      inputSchema: z.object({
        runId: z.string().regex(/^run_[0-9a-f-]{36}$/),
      }),
      outputSchema: jsonObjectSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ runId }) =>
      safeStructuredResult(async () =>
        structuredJson(await execution.cancel(runId)),
      ),
  );

  server.registerTool(
    "evidence_get",
    {
      title: "Read operation evidence",
      description:
        "Return the immutable plan, source binding, command, bounded output, and terminal or current run state.",
      inputSchema: z.object({
        runId: z.string().regex(/^run_[0-9a-f-]{36}$/),
      }),
      outputSchema: jsonObjectSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ runId }) =>
      safeStructuredResult(async () =>
        structuredJson(await execution.evidence(runId)),
      ),
  );

  server.registerTool(
    "expo_router_sitemap",
    {
      title: "Read Expo Router sitemap",
      description:
        "Query routes from a verified local Expo project through its local Expo MCP provider.",
      inputSchema: expoWorkspaceInputSchema,
      outputSchema: jsonObjectSchema,
      annotations: readOnlyAnnotations,
    },
    async (input) =>
      safeExpoResult(() =>
        getExpoRouterSitemap(input.workspacePath, compact(input)),
      ),
  );

  server.registerTool(
    "expo_take_screenshot",
    {
      title: "Capture Expo simulator screenshot",
      description:
        "Capture full-app or testID-scoped visual evidence from a booted simulator or connected test device.",
      inputSchema: expoWorkspaceInputSchema.extend({
        platform: z.enum(["ios", "android"]).optional(),
        testID: z.string().min(1).max(200).optional(),
      }),
      outputSchema: jsonObjectSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ workspacePath, platform, testID, ...options }) =>
      safeExpoResult(() =>
        takeExpoScreenshot(
          workspacePath,
          compact({ platform, testID }),
          compact(options),
        ),
      ),
  );

  server.registerTool(
    "expo_find_view",
    {
      title: "Inspect Expo view",
      description:
        "Find a React Native view by testID and return its properties without mutating the app.",
      inputSchema: expoWorkspaceInputSchema.extend({
        platform: z.enum(["ios", "android"]).optional(),
        testID: z.string().min(1).max(200),
      }),
      outputSchema: jsonObjectSchema,
      annotations: readOnlyAnnotations,
    },
    async ({ workspacePath, platform, testID, ...options }) =>
      safeExpoResult(() =>
        findExpoView(
          workspacePath,
          compact({ platform, testID }),
          compact(options),
        ),
      ),
  );

  server.registerTool(
    "expo_collect_logs",
    {
      title: "Collect Expo app logs",
      description:
        "Collect bounded JavaScript or native test-device logs through local Expo MCP.",
      inputSchema: expoWorkspaceInputSchema.extend({
        sources: z
          .array(
            z.enum(["native_android", "native_ios", "js_console"]),
          )
          .min(1)
          .optional(),
        durationMs: z.number().int().min(0).max(10_000).optional(),
        appId: z.string().min(1).max(200).optional(),
        filter: z.string().min(1).max(500).optional(),
        logLevel: z.string().min(1).max(50).optional(),
      }),
      outputSchema: jsonObjectSchema,
      annotations: readOnlyAnnotations,
    },
    async ({
      workspacePath,
      sources,
      durationMs,
      appId,
      filter,
      logLevel,
      ...options
    }) =>
      safeExpoResult(() =>
        collectExpoLogs(
          workspacePath,
          compact({
            sources,
            durationMs,
            appId,
            filter,
            logLevel,
          }),
          compact(options),
        ),
      ),
  );

  return server;
}

export function serveRunDocketMcp(): StdioServerHandle {
  return serveStdio(() => createRunDocketMcpServer(), {
    onerror: (error) => {
      process.stderr.write(`RunDocket MCP: ${error.message}\n`);
    },
  });
}

async function safeStructuredResult(
  action: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await action();
  } catch (error) {
    return errorResult(error);
  }
}

async function safeExpoResult(
  action: () => Promise<ExpoToolResult>,
): Promise<CallToolResult> {
  try {
    const result = await action();
    const metadata = expoMetadata(result);
    return {
      isError: result.isError,
      content: [
        {
          type: "text",
          text: JSON.stringify(metadata, null, 2),
        },
        ...result.content,
      ],
      structuredContent: metadata,
    };
  } catch (error) {
    return errorResult(error);
  }
}

function structuredJson(value: unknown): CallToolResult {
  const structuredContent = toJsonObject(value);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    structuredContent,
  };
}

function expoMetadata(
  result: ExpoToolResult,
): Record<string, unknown> {
  return {
    schemaVersion: result.schemaVersion,
    status: result.status,
    generatedAt: result.generatedAt,
    provider: result.provider,
    upstreamTool: result.upstreamTool,
    project: result.project,
    devServerUrl: result.devServerUrl,
    providerVersion: result.providerVersion,
    isError: result.isError,
    evidence: result.evidence,
  };
}

function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  const code =
    error instanceof ExecutionError ? error.code : "TOOL_FAILED";
  const structuredContent = {
    schemaVersion: "rundocket.error.v1",
    status: "FAILED",
    error: {
      code,
      message,
    },
  };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

function toJsonObject(value: unknown): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(value)) as unknown;
  if (
    cloned === null ||
    typeof cloned !== "object" ||
    Array.isArray(cloned)
  ) {
    throw new Error("MCP structured output must be a JSON object.");
  }
  return cloned as Record<string, unknown>;
}

function compact<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}
