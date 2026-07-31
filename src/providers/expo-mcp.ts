import {
  Client,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import {
  resolveExpoLocalContext,
  type DoctorOptions,
} from "../doctor.js";

export const EXPO_TOOL_SCHEMA_VERSION =
  "rundocket.expo-tool.v1" as const;

export type ExpoPlatform = "android" | "ios";
export type ExpoLogSource =
  | "native_android"
  | "native_ios"
  | "js_console";
export type ExpoToolName =
  | "expo_router_sitemap"
  | "automation_take_screenshot"
  | "automation_find_view"
  | "collect_app_logs";

export type ExpoToolContent =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image";
      data: string;
      mimeType: string;
    };

export interface ExpoToolResult {
  schemaVersion: typeof EXPO_TOOL_SCHEMA_VERSION;
  status: "VERIFIED" | "UNVERIFIED";
  generatedAt: string;
  provider: "expo-mcp-local";
  upstreamTool: ExpoToolName;
  project: {
    id: string;
    root: string;
  };
  devServerUrl: string;
  providerVersion: string | null;
  isError: boolean;
  content: ExpoToolContent[];
  evidence: {
    contentTypes: string[];
    imageBytesApproximate: number;
  };
}

export interface ExpoProviderOptions extends DoctorOptions {
  timeoutMs?: number;
}

export async function getExpoRouterSitemap(
  workspacePath: string,
  options: ExpoProviderOptions = {},
): Promise<ExpoToolResult> {
  return callExpoTool(
    workspacePath,
    "expo_router_sitemap",
    {},
    options,
  );
}

export async function takeExpoScreenshot(
  workspacePath: string,
  input: {
    platform?: ExpoPlatform | undefined;
    testID?: string | undefined;
  } = {},
  options: ExpoProviderOptions = {},
): Promise<ExpoToolResult> {
  return callExpoTool(
    workspacePath,
    "automation_take_screenshot",
    compact({
      platform: input.platform,
      testID: normalizeOptionalText(input.testID, "testID"),
    }),
    options,
  );
}

export async function findExpoView(
  workspacePath: string,
  input: {
    testID: string;
    platform?: ExpoPlatform | undefined;
  },
  options: ExpoProviderOptions = {},
): Promise<ExpoToolResult> {
  return callExpoTool(
    workspacePath,
    "automation_find_view",
    compact({
      testID: normalizeRequiredText(input.testID, "testID"),
      platform: input.platform,
    }),
    options,
  );
}

export async function collectExpoLogs(
  workspacePath: string,
  input: {
    sources?: ExpoLogSource[] | undefined;
    durationMs?: number | undefined;
    appId?: string | undefined;
    filter?: string | undefined;
    logLevel?: string | undefined;
  } = {},
  options: ExpoProviderOptions = {},
): Promise<ExpoToolResult> {
  const durationMs = input.durationMs ?? 2_000;
  if (
    !Number.isInteger(durationMs) ||
    durationMs < 0 ||
    durationMs > 10_000
  ) {
    throw new Error("durationMs must be an integer between 0 and 10000.");
  }

  const sources = input.sources ?? ["js_console"];
  if (sources.length === 0) {
    throw new Error("At least one log source is required.");
  }

  return callExpoTool(
    workspacePath,
    "collect_app_logs",
    compact({
      sources: [...new Set(sources)],
      durationMs,
      appId: normalizeOptionalText(input.appId, "appId"),
      filter: normalizeOptionalText(input.filter, "filter"),
      logLevel: normalizeOptionalText(input.logLevel, "logLevel"),
    }),
    options,
  );
}

async function callExpoTool(
  workspacePath: string,
  toolName: ExpoToolName,
  upstreamArguments: Record<string, unknown>,
  options: ExpoProviderOptions,
): Promise<ExpoToolResult> {
  const context = await resolveExpoLocalContext(workspacePath, options);
  if (context.expoMcpCommand === null) {
    throw new Error(
      "Local Expo MCP is unavailable. Install expo-mcp in the selected Expo project.",
    );
  }
  if (context.devServerUrl === null) {
    throw new Error(
      "Local Expo MCP needs a running loopback Expo development server.",
    );
  }
  if (
    ["automation_take_screenshot", "automation_find_view"].includes(
      toolName,
    ) &&
    context.bootedIosSimulatorCount +
      context.connectedAndroidDeviceCount ===
      0
  ) {
    throw new Error(
      "Device evidence requires a booted iOS simulator or connected Android device.",
    );
  }

  const transport = new StdioClientTransport({
    command: context.expoMcpCommand,
    args: [
      "--dev-server-url",
      context.devServerUrl,
      "--root",
      context.projectRoot,
    ],
    cwd: context.projectRoot,
    stderr: "pipe",
    maxBufferSize: 12 * 1024 * 1024,
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk: Buffer) => {
    if (stderr.length < 8_192) {
      stderr += chunk.toString("utf8").slice(0, 8_192 - stderr.length);
    }
  });

  const client = new Client({
    name: "rundocket-expo-provider",
    version: "0.0.1",
  });
  let connected = false;

  try {
    await withTimeout(
      client.connect(transport),
      10_000,
      "Expo MCP connection",
    );
    connected = true;

    const tools = await withTimeout(
      client.listTools(),
      10_000,
      "Expo MCP tool discovery",
    );
    if (!tools.tools.some((tool) => tool.name === toolName)) {
      throw new Error(
        `The connected Expo MCP server does not expose ${toolName}.`,
      );
    }

    const result = await withTimeout(
      client.callTool({
        name: toolName,
        arguments: {
          ...upstreamArguments,
          ...(toolName === "expo_router_sitemap"
            ? {}
            : { projectRoot: context.projectRoot }),
        },
      }),
      options.timeoutMs ?? 30_000,
      `Expo MCP tool ${toolName}`,
    );
    const content = normalizeContent(result);
    const isError =
      result.isError === true ||
      containsSemanticFailure(toolName, content);

    return {
      schemaVersion: EXPO_TOOL_SCHEMA_VERSION,
      status: isError ? "UNVERIFIED" : "VERIFIED",
      generatedAt: new Date().toISOString(),
      provider: "expo-mcp-local",
      upstreamTool: toolName,
      project: {
        id: context.project.id,
        root: context.projectRoot,
      },
      devServerUrl: context.devServerUrl,
      providerVersion: context.expoMcpVersion,
      isError,
      content,
      evidence: {
        contentTypes: content.map((item) => item.type),
        imageBytesApproximate: content
          .filter(
            (
              item,
            ): item is Extract<ExpoToolContent, { type: "image" }> =>
              item.type === "image",
          )
          .reduce(
            (total, item) =>
              total + Math.floor((item.data.length * 3) / 4),
            0,
          ),
      },
    };
  } catch (error) {
    const suffix =
      stderr.trim() === ""
        ? ""
        : " The provider also reported a sanitized stderr summary.";
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${suffix}`);
  } finally {
    if (connected) {
      await client.close().catch(() => undefined);
    } else {
      await transport.close().catch(() => undefined);
    }
  }
}

function normalizeContent(result: CallToolResult): ExpoToolContent[] {
  const content: ExpoToolContent[] = [];
  for (const item of result.content) {
    if (item.type === "text") {
      content.push({ type: "text", text: item.text });
      continue;
    }
    if (item.type === "image") {
      content.push({
        type: "image",
        data: item.data,
        mimeType: item.mimeType,
      });
      continue;
    }
    throw new Error(
      `Expo MCP returned unsupported content type: ${item.type}`,
    );
  }
  return content;
}

function containsSemanticFailure(
  toolName: ExpoToolName,
  content: ExpoToolContent[],
): boolean {
  if (toolName !== "automation_find_view") {
    return false;
  }
  return content.some((item) => {
    if (item.type !== "text") {
      return false;
    }
    try {
      const parsed = JSON.parse(item.text) as {
        success?: unknown;
        error?: unknown;
      };
      return parsed.success === false || typeof parsed.error === "string";
    } catch {
      return false;
    }
  });
}

function normalizeRequiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > 200) {
    throw new Error(`${field} must contain between 1 and 200 characters.`);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | undefined,
  field: string,
): string | undefined {
  return value === undefined
    ? undefined
    : normalizeRequiredText(value, field);
}

function compact(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs} ms.`));
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
