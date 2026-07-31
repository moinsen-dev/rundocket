import { readFile } from "node:fs/promises";
import path from "node:path";

import { inspectWorkspace } from "./discovery.js";
import { isFile } from "./fs-utils.js";
import type {
  CapabilityAvailability,
  CapabilityRisk,
  DetectedProject,
  InspectStatus,
  ProjectKind,
} from "./model.js";
import {
  findExecutable,
  findLocalProjectBinary,
  findProjectBinary,
  runCommand,
  type CommandResult,
} from "./process-utils.js";
import { selectPrimaryProject } from "./project-selection.js";

export const DOCTOR_SCHEMA_VERSION = "rundocket.doctor.v1" as const;

export interface DoctorOptions {
  maxDepth?: number | undefined;
  projectId?: string | undefined;
  expoDevServerUrl?: string | undefined;
  timeoutMs?: number | undefined;
}

export interface ReadinessCapability {
  name: string;
  availability: CapabilityAvailability;
  risk: CapabilityRisk;
  reason: string;
}

export interface ToolProbe {
  name: string;
  availability: CapabilityAvailability;
  path: string | null;
  version: string | null;
  authenticated: boolean | null;
  reason: string;
}

export interface ProviderReadiness {
  id: string;
  kind: "core" | "framework" | "device" | "cloud";
  availability: CapabilityAvailability;
  reason: string;
  tools: ToolProbe[];
  capabilities: ReadinessCapability[];
  details: Record<string, string | number | boolean | null | string[]>;
}

export interface DoctorDiagnostic {
  level: "warning" | "error";
  code: string;
  message: string;
}

export interface DoctorResult {
  schemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  status: Exclude<InspectStatus, "FAILED">;
  generatedAt: string;
  workspace: {
    root: string;
    inspectionStatus: Exclude<InspectStatus, "FAILED">;
    selectedProjectId: string | null;
  };
  selectedProject: {
    id: string;
    kind: ProjectKind;
    root: string;
    mode: string;
    platforms: string[];
  } | null;
  providers: ProviderReadiness[];
  capabilities: ReadinessCapability[];
  diagnostics: DoctorDiagnostic[];
}

export interface ExpoLocalContext {
  project: DetectedProject;
  projectRoot: string;
  expoMcpCommand: string | null;
  expoMcpVersion: string | null;
  devServerUrl: string | null;
  bootedIosSimulatorCount: number;
  connectedAndroidDeviceCount: number;
}

export async function doctorWorkspace(
  workspacePath: string,
  options: DoctorOptions = {},
): Promise<DoctorResult> {
  const inspection = await inspectWorkspace(
    workspacePath,
    options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth },
  );
  const selected = selectPrimaryProject(inspection, options.projectId);
  const diagnostics: DoctorDiagnostic[] = inspection.diagnostics.map(
    (diagnostic) => ({
      level: "warning",
      code: diagnostic.code,
      message: `${diagnostic.path}: ${diagnostic.message}`,
    }),
  );

  if (selected.project === null || selected.absoluteRoot === null) {
    diagnostics.push({
      level: selected.status === "NEEDS_INPUT" ? "error" : "warning",
      code:
        selected.status === "NEEDS_INPUT"
          ? "PROJECT_SELECTION_REQUIRED"
          : "PROJECT_UNAVAILABLE",
      message: selected.reason,
    });
  }

  const providers: ProviderReadiness[] = [coreProvider()];
  if (selected.project !== null && selected.absoluteRoot !== null) {
    providers.push(
      ...(await frameworkProviders(
        selected.project,
        selected.absoluteRoot,
        options,
      )),
    );
  }

  const capabilities = mergeCapabilities(
    providers.flatMap((provider) => provider.capabilities),
  );

  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    status: selected.status,
    generatedAt: new Date().toISOString(),
    workspace: {
      root: inspection.workspace.root,
      inspectionStatus: inspection.status,
      selectedProjectId: selected.project?.id ?? null,
    },
    selectedProject:
      selected.project === null || selected.absoluteRoot === null
        ? null
        : {
            id: selected.project.id,
            kind: selected.project.kind,
            root: selected.absoluteRoot,
            mode: selected.project.mode,
            platforms: selected.project.platforms,
          },
    providers,
    capabilities,
    diagnostics,
  };
}

export async function resolveExpoLocalContext(
  workspacePath: string,
  options: DoctorOptions = {},
): Promise<ExpoLocalContext> {
  const inspection = await inspectWorkspace(
    workspacePath,
    options.maxDepth === undefined ? {} : { maxDepth: options.maxDepth },
  );
  const selected = selectPrimaryProject(inspection, options.projectId);

  if (selected.project === null || selected.absoluteRoot === null) {
    throw new Error(selected.reason);
  }
  if (selected.project.kind !== "expo") {
    throw new Error(
      `Expo local capabilities require an Expo project; selected ${selected.project.kind}.`,
    );
  }

  const timeoutMs = options.timeoutMs ?? 4_000;
  const expoMcpCommand = await findLocalProjectBinary(
    selected.absoluteRoot,
    "expo-mcp",
  );
  const expoMcpVersion = await readInstalledPackageVersion(
    selected.absoluteRoot,
    "expo-mcp",
  );
  const devServer = await probeExpoDevServer(
    options.expoDevServerUrl,
    timeoutMs,
  );
  const [bootedIosSimulatorCount, connectedAndroidDeviceCount] =
    await Promise.all([
      countBootedIosSimulators(timeoutMs),
      countConnectedAndroidDevices(timeoutMs),
    ]);

  return {
    project: selected.project,
    projectRoot: selected.absoluteRoot,
    expoMcpCommand,
    expoMcpVersion,
    devServerUrl: devServer.url,
    bootedIosSimulatorCount,
    connectedAndroidDeviceCount,
  };
}

export function formatDoctorResult(result: DoctorResult): string {
  const lines = [
    "RunDocket doctor",
    `Status: ${result.status}`,
    `Workspace: ${result.workspace.root}`,
    `Selected: ${result.workspace.selectedProjectId ?? "none"}`,
    "Capabilities:",
  ];

  for (const capability of result.capabilities) {
    lines.push(
      `  - ${capability.name}: ${capability.availability} (${capability.reason})`,
    );
  }

  lines.push("Providers:");
  for (const provider of result.providers) {
    lines.push(
      `  - ${provider.id}: ${provider.availability} (${provider.reason})`,
    );
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(
      `${diagnostic.level === "error" ? "Error" : "Warning"} [${
        diagnostic.code
      }]: ${diagnostic.message}`,
    );
  }

  return lines.join("\n");
}

function coreProvider(): ProviderReadiness {
  return {
    id: "rundocket-core",
    kind: "core",
    availability: "available",
    reason: "The local RunDocket inspection, readiness, planning, and MCP core is available.",
    tools: [
      {
        name: "node",
        availability: "available",
        path: process.execPath,
        version: process.version,
        authenticated: null,
        reason: "RunDocket is executing with this Node.js runtime.",
      },
    ],
    capabilities: [
      capability(
        "inspect",
        "available",
        "read_only",
        "Workspace inspection is implemented.",
      ),
      capability(
        "doctor",
        "available",
        "read_only",
        "Read-only prerequisite probing is implemented.",
      ),
      capability(
        "plan",
        "available",
        "read_only",
        "Immutable operation planning is implemented.",
      ),
      capability(
        "mcp",
        "available",
        "read_only",
        "The headless stdio MCP integration is implemented.",
      ),
      capability(
        "operation_apply",
        "available",
        "local_mutation",
        "Approval-aware execution is implemented for explicitly verified adapter operations.",
      ),
      capability(
        "operation_status",
        "available",
        "read_only",
        "Managed run status and bounded output are available in the MCP session.",
      ),
      capability(
        "operation_cancel",
        "available",
        "local_mutation",
        "Managed process groups can be cancelled by run ID.",
      ),
      capability(
        "evidence_get",
        "available",
        "read_only",
        "Plans, source bindings, command output, and run results are available.",
      ),
      capability(
        "store_release",
        "blocked",
        "prohibited",
        "Signing, upload, and release remain default-deny.",
      ),
    ],
    details: {
      transport: "stdio",
      protocol: "MCP 2026-07-28 with legacy compatibility",
    },
  };
}

async function frameworkProviders(
  project: DetectedProject,
  projectRoot: string,
  options: DoctorOptions,
): Promise<ProviderReadiness[]> {
  switch (project.kind) {
    case "expo":
      return expoProviders(project, projectRoot, options);
    case "flutter":
      return [await flutterProvider(projectRoot, options.timeoutMs ?? 5_000)];
    case "xcode":
      return [await xcodeProvider(projectRoot, options.timeoutMs ?? 5_000)];
  }
}

async function expoProviders(
  project: DetectedProject,
  projectRoot: string,
  options: DoctorOptions,
): Promise<ProviderReadiness[]> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const [expoCommand, expoMcpCommand, easCommand, devServer, iosCount, androidCount] =
    await Promise.all([
      findProjectBinary(projectRoot, "expo"),
      findLocalProjectBinary(projectRoot, "expo-mcp"),
      findProjectBinary(projectRoot, "eas"),
      probeExpoDevServer(options.expoDevServerUrl, timeoutMs),
      countBootedIosSimulators(timeoutMs),
      countConnectedAndroidDevices(timeoutMs),
    ]);

  const [expoVersion, expoMcpVersion, expoAuth, easVersion, easAuth] =
    await Promise.all([
      readInstalledPackageVersion(projectRoot, "expo"),
      readInstalledPackageVersion(projectRoot, "expo-mcp"),
      probeAuthentication(expoCommand, ["whoami"], projectRoot, timeoutMs),
      probeVersion(easCommand, ["--version"], projectRoot, timeoutMs),
      probeAuthentication(easCommand, ["whoami"], projectRoot, timeoutMs),
    ]);

  const localToolAvailability: CapabilityAvailability =
    expoCommand === null ? "unavailable" : "available";
  const mcpAvailability: CapabilityAvailability =
    expoMcpCommand === null
      ? "unavailable"
      : devServer.url === null
        ? "needs_server"
        : "available";
  const deviceCount = iosCount + androidCount;
  const deviceAvailability: CapabilityAvailability =
    deviceCount > 0 ? "available" : "unavailable";

  const localProvider: ProviderReadiness = {
    id: "expo-local",
    kind: "framework",
    availability: localToolAvailability,
    reason:
      expoCommand === null
        ? "No Expo CLI executable was found."
        : "The project-local Expo CLI is available.",
    tools: [
      {
        name: "expo",
        availability: localToolAvailability,
        path: expoCommand,
        version: expoVersion,
        authenticated: expoAuth.authenticated,
        reason:
          expoCommand === null
            ? "Install project dependencies to provide Expo CLI."
            : expoAuth.reason,
      },
    ],
    capabilities: [
      capability(
        "start",
        localToolAvailability,
        "local_mutation",
        expoCommand === null
          ? "Expo CLI is required to start a managed development server."
          : "Managed Expo development-server start is implemented.",
      ),
      capability(
        "build",
        "planned",
        "local_mutation",
        "Expo build execution is not implemented yet.",
      ),
      capability(
        "test",
        "planned",
        "local_mutation",
        "Expo test execution is not implemented yet.",
      ),
      capability(
        "launch",
        "planned",
        "local_mutation",
        "Expo launch execution is not implemented yet.",
      ),
      capability(
        "logs",
        mcpAvailability,
        "read_only",
        mcpAvailability === "available"
          ? "JavaScript and native logs are available through local Expo MCP."
          : "Local Expo MCP and a running development server are required.",
      ),
    ],
    details: {
      projectMode: project.mode,
      platforms: project.platforms,
      authenticated: expoAuth.authenticated,
    },
  };

  const mcpProvider: ProviderReadiness = {
    id: "expo-mcp-local",
    kind: "device",
    availability: mcpAvailability,
    reason:
      expoMcpCommand === null
        ? "The expo-mcp package is not installed."
        : devServer.url === null
          ? "expo-mcp is installed but no local Expo development server answered."
          : "Local Expo MCP and the development server are available.",
    tools: [
      {
        name: "expo-mcp",
        availability:
          expoMcpCommand === null ? "unavailable" : "available",
        path: expoMcpCommand,
        version: expoMcpVersion,
        authenticated: null,
        reason:
          expoMcpCommand === null
            ? "Install expo-mcp in the Expo project."
            : "The project-local expo-mcp executable is available.",
      },
    ],
    capabilities: [
      capability(
        "expo_router_sitemap",
        mcpAvailability,
        "read_only",
        mcpReason(mcpAvailability, "Router sitemap"),
      ),
      capability(
        "expo_collect_logs",
        mcpAvailability,
        "read_only",
        mcpReason(mcpAvailability, "Log collection"),
      ),
      capability(
        "expo_take_screenshot",
        mcpAvailability === "available"
          ? deviceAvailability
          : mcpAvailability,
        "read_only",
        mcpAvailability !== "available"
          ? mcpReason(mcpAvailability, "Screenshot capture")
          : deviceCount > 0
            ? "At least one supported booted device is available."
            : "A booted iOS simulator or connected Android device is required.",
      ),
      capability(
        "expo_find_view",
        mcpAvailability === "available"
          ? deviceAvailability
          : mcpAvailability,
        "read_only",
        mcpAvailability !== "available"
          ? mcpReason(mcpAvailability, "View inspection")
          : deviceCount > 0
            ? "At least one supported booted device is available."
            : "A booted iOS simulator or connected Android device is required.",
      ),
      capability(
        "expo_tap",
        "blocked",
        "local_mutation",
        "UI mutation is intentionally excluded from the read-only MCP slice.",
      ),
    ],
    details: {
      devServerUrl: devServer.url,
      devServerEvidence: devServer.reason,
      bootedIosSimulatorCount: iosCount,
      connectedAndroidDeviceCount: androidCount,
      screenshotDataPolicy: "May proxy through Expo; use test data only.",
    },
  };

  const easAvailability: CapabilityAvailability =
    easCommand === null
      ? "unavailable"
      : easAuth.authenticated === true
        ? "available"
        : "needs_auth";
  const easProvider: ProviderReadiness = {
    id: "expo-eas-cli",
    kind: "cloud",
    availability: easAvailability,
    reason:
      easCommand === null
        ? "No EAS CLI executable was found."
        : easAuth.reason,
    tools: [
      {
        name: "eas",
        availability: easCommand === null ? "unavailable" : "available",
        path: easCommand,
        version: easVersion,
        authenticated: easAuth.authenticated,
        reason:
          easCommand === null ? "Install EAS CLI." : easAuth.reason,
      },
    ],
    capabilities: [
      capability(
        "eas_read",
        "planned",
        "read_only",
        easAvailability === "available"
          ? "EAS is ready, but read operations are not wrapped yet."
          : "EAS read operations require a ready authenticated CLI and a future adapter.",
      ),
      capability(
        "eas_build",
        "blocked",
        "external_binding",
        "Remote build mutation requires a later approval-aware adapter.",
      ),
      capability(
        "eas_submit",
        "blocked",
        "prohibited",
        "Store submission and release remain default-deny.",
      ),
    ],
    details: {
      authenticated: easAuth.authenticated,
    },
  };

  return [localProvider, mcpProvider, easProvider];
}

async function flutterProvider(
  projectRoot: string,
  timeoutMs: number,
): Promise<ProviderReadiness> {
  const command = await findExecutable("flutter");
  const version = await probeFlutterVersion(command, projectRoot, timeoutMs);
  const availability: CapabilityAvailability =
    command === null ? "unavailable" : "available";

  return {
    id: "flutter-local",
    kind: "framework",
    availability,
    reason:
      command === null
        ? "No Flutter executable was found."
        : "The Flutter CLI is available.",
    tools: [
      {
        name: "flutter",
        availability,
        path: command,
        version,
        authenticated: null,
        reason:
          command === null
            ? "Install Flutter or add it to PATH."
            : "The Flutter CLI executable is available.",
      },
    ],
    capabilities: plannedFrameworkCapabilities("Flutter"),
    details: {},
  };
}

async function xcodeProvider(
  projectRoot: string,
  timeoutMs: number,
): Promise<ProviderReadiness> {
  const [xcodebuild, xcrun] = await Promise.all([
    findExecutable("xcodebuild"),
    findExecutable("xcrun"),
  ]);
  const version = await probeVersion(
    xcodebuild,
    ["-version"],
    projectRoot,
    timeoutMs,
  );
  const availability: CapabilityAvailability =
    xcodebuild === null || xcrun === null ? "unavailable" : "available";

  return {
    id: "xcode-local",
    kind: "framework",
    availability,
    reason:
      availability === "available"
        ? "Xcode build and developer-tool executables are available."
        : "Both xcodebuild and xcrun are required.",
    tools: [
      {
        name: "xcodebuild",
        availability: xcodebuild === null ? "unavailable" : "available",
        path: xcodebuild,
        version,
        authenticated: null,
        reason:
          xcodebuild === null
            ? "Install Xcode command-line tools."
            : "xcodebuild is available.",
      },
      {
        name: "xcrun",
        availability: xcrun === null ? "unavailable" : "available",
        path: xcrun,
        version: null,
        authenticated: null,
        reason:
          xcrun === null
            ? "Install Xcode command-line tools."
            : "xcrun is available.",
      },
    ],
    capabilities: plannedFrameworkCapabilities("Xcode"),
    details: {},
  };
}

function plannedFrameworkCapabilities(
  framework: string,
): ReadinessCapability[] {
  return [
    capability(
      "build",
      "planned",
      "local_mutation",
      `${framework} build execution is not implemented yet.`,
    ),
    capability(
      "test",
      "planned",
      "local_mutation",
      `${framework} test execution is not implemented yet.`,
    ),
    capability(
      "launch",
      "planned",
      "local_mutation",
      `${framework} launch execution is not implemented yet.`,
    ),
    capability(
      "logs",
      "planned",
      "read_only",
      `${framework} log collection is not implemented yet.`,
    ),
  ];
}

function capability(
  name: string,
  availability: CapabilityAvailability,
  risk: CapabilityRisk,
  reason: string,
): ReadinessCapability {
  return { name, availability, risk, reason };
}

function mergeCapabilities(
  capabilities: ReadinessCapability[],
): ReadinessCapability[] {
  const byName = new Map<string, ReadinessCapability>();
  for (const item of capabilities) {
    const existing = byName.get(item.name);
    if (
      existing === undefined ||
      availabilityRank(item.availability) >
        availabilityRank(existing.availability)
    ) {
      byName.set(item.name, item);
    }
  }
  return [...byName.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function availabilityRank(availability: CapabilityAvailability): number {
  switch (availability) {
    case "available":
      return 8;
    case "needs_auth":
      return 7;
    case "needs_server":
      return 6;
    case "needs_input":
      return 5;
    case "unverified":
      return 4;
    case "planned":
      return 3;
    case "unavailable":
      return 2;
    case "blocked":
      return 1;
  }
}

function mcpReason(
  availability: CapabilityAvailability,
  label: string,
): string {
  switch (availability) {
    case "available":
      return `${label} is available through local Expo MCP.`;
    case "needs_server":
      return `${label} requires a running local Expo development server.`;
    case "unavailable":
      return `${label} requires the expo-mcp package.`;
    default:
      return `${label} is ${availability}.`;
  }
}

interface AuthenticationProbe {
  authenticated: boolean | null;
  reason: string;
}

async function probeAuthentication(
  command: string | null,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<AuthenticationProbe> {
  if (command === null) {
    return {
      authenticated: null,
      reason: "The CLI executable is unavailable.",
    };
  }

  const result = await runCommand(command, args, {
    cwd,
    timeoutMs,
    maxOutputBytes: 16_384,
  });
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();

  if (result.timedOut) {
    return {
      authenticated: null,
      reason: "Authentication status probe timed out.",
    };
  }
  if (
    result.exitCode === 0 &&
    !output.includes("not logged") &&
    !output.includes("not authenticated")
  ) {
    return {
      authenticated: true,
      reason: "The CLI reports an authenticated session.",
    };
  }

  return {
    authenticated: false,
    reason: "The CLI does not report an authenticated session.",
  };
}

async function probeVersion(
  command: string | null,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<string | null> {
  if (command === null) {
    return null;
  }
  const result = await runCommand(command, args, {
    cwd,
    timeoutMs,
    maxOutputBytes: 8_192,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    return null;
  }
  return firstMeaningfulLine(result);
}

async function probeFlutterVersion(
  command: string | null,
  cwd: string,
  timeoutMs: number,
): Promise<string | null> {
  if (command === null) {
    return null;
  }
  const result = await runCommand(
    command,
    ["--version", "--machine", "--suppress-analytics"],
    {
      cwd,
      timeoutMs,
      maxOutputBytes: 16_384,
    },
  );
  if (result.exitCode !== 0 || result.timedOut) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout) as {
      frameworkVersion?: unknown;
    };
    return typeof parsed.frameworkVersion === "string"
      ? parsed.frameworkVersion
      : null;
  } catch {
    return firstMeaningfulLine(result);
  }
}

function firstMeaningfulLine(result: CommandResult): string | null {
  return (
    `${result.stdout}\n${result.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

async function readInstalledPackageVersion(
  projectRoot: string,
  packageName: string,
): Promise<string | null> {
  let directory = path.resolve(projectRoot);
  const filesystemRoot = path.parse(directory).root;

  while (true) {
    const packagePath = path.join(
      directory,
      "node_modules",
      ...packageName.split("/"),
      "package.json",
    );
    if (await isFile(packagePath)) {
      try {
        const parsed = JSON.parse(await readFile(packagePath, "utf8")) as {
          version?: unknown;
        };
        return typeof parsed.version === "string" ? parsed.version : null;
      } catch {
        return null;
      }
    }

    if (directory === filesystemRoot) {
      return null;
    }
    directory = path.dirname(directory);
  }
}

interface DevServerProbe {
  url: string | null;
  reason: string;
}

async function probeExpoDevServer(
  explicitUrl: string | undefined,
  timeoutMs: number,
): Promise<DevServerProbe> {
  const candidates = [
    explicitUrl,
    process.env.RUNDOCKET_EXPO_DEV_SERVER_URL,
    "http://127.0.0.1:8081",
    "http://127.0.0.1:19000",
    "http://127.0.0.1:19001",
    "http://127.0.0.1:19002",
  ].filter((candidate): candidate is string => candidate !== undefined);

  for (const candidate of [...new Set(candidates)]) {
    let url: URL;
    try {
      url = normalizeLoopbackUrl(candidate);
    } catch {
      if (candidate === explicitUrl) {
        return {
          url: null,
          reason:
            "The explicit Expo development server URL is not a valid loopback HTTP URL.",
        };
      }
      continue;
    }

    try {
      const response = await fetch(new URL("status", url), {
        signal: AbortSignal.timeout(Math.min(timeoutMs, 1_500)),
      });
      const text = await response.text();
      if (response.ok && /packager-status:running/i.test(text)) {
        return {
          url: url.toString().replace(/\/$/, ""),
          reason: "GET /status returned packager-status:running.",
        };
      }
    } catch {
      // Try the next known local development-server port.
    }
  }

  return {
    url: null,
    reason: "No known loopback Expo development server answered.",
  };
}

function normalizeLoopbackUrl(input: string): URL {
  const url = new URL(input);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Unsupported protocol.");
  }
  const host = url.hostname.toLowerCase();
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error("Only loopback development servers are allowed.");
  }
  url.pathname = url.pathname.endsWith("/")
    ? url.pathname
    : `${url.pathname}/`;
  url.search = "";
  url.hash = "";
  return url;
}

async function countBootedIosSimulators(timeoutMs: number): Promise<number> {
  if (process.platform !== "darwin") {
    return 0;
  }
  const xcrun = await findExecutable("xcrun");
  if (xcrun === null) {
    return 0;
  }
  const result = await runCommand(
    xcrun,
    ["simctl", "list", "devices", "booted", "--json"],
    { timeoutMs, maxOutputBytes: 128 * 1024 },
  );
  if (result.exitCode !== 0 || result.timedOut) {
    return 0;
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      devices?: Record<
        string,
        Array<{ state?: unknown; isAvailable?: unknown }>
      >;
    };
    return Object.values(parsed.devices ?? {})
      .flat()
      .filter(
        (device) =>
          device.state === "Booted" && device.isAvailable !== false,
      ).length;
  } catch {
    return 0;
  }
}

async function countConnectedAndroidDevices(
  timeoutMs: number,
): Promise<number> {
  const adb = await findExecutable("adb");
  if (adb === null) {
    return 0;
  }
  const result = await runCommand(adb, ["devices"], {
    timeoutMs,
    maxOutputBytes: 32_768,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    return 0;
  }
  return result.stdout
    .split(/\r?\n/)
    .filter((line) => /\tdevice\s*$/.test(line)).length;
}
