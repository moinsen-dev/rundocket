import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  doctorWorkspace,
  type DoctorResult,
  type ToolProbe,
} from "./doctor.js";
import { inspectWorkspace } from "./discovery.js";
import { fingerprintDirectory, type SourceFingerprint } from "./fingerprint.js";
import type {
  CapabilityAvailability,
  CapabilityRisk,
  DetectedProject,
  InspectStatus,
  ProjectKind,
} from "./model.js";
import { selectPrimaryProject } from "./project-selection.js";
import { findProjectBinary } from "./process-utils.js";
import {
  signalContract,
  signalsFor,
  type SignalContract,
} from "./signals.js";

export const PLAN_SCHEMA_VERSION = "rundocket.plan.v2" as const;

export type OperationName =
  | "start"
  | "build"
  | "test"
  | "launch"
  | "logs";

export interface OperationParameters {
  platform?: string | undefined;
  scheme?: string | undefined;
  configuration?: string | undefined;
  destination?: string | undefined;
  deviceId?: string | undefined;
  sources?: string[] | undefined;
  port?: number | undefined;
}

export interface PlanOptions {
  maxDepth?: number | undefined;
  projectId?: string | undefined;
  expoDevServerUrl?: string | undefined;
  parameters?: OperationParameters | undefined;
}

export interface PlannedCommand {
  executable: string;
  args: string[];
  cwd: string;
  /** Adapter-required environment applied on top of the inherited process env. */
  env: Record<string, string>;
}

export interface OperationPlan {
  schemaVersion: typeof PLAN_SCHEMA_VERSION;
  status: Exclude<InspectStatus, "FAILED">;
  generatedAt: string;
  planId: string | null;
  immutable: true;
  workspace: {
    root: string;
    selectedProjectId: string | null;
    candidateProjectIds: string[];
  };
  project: {
    id: string;
    kind: ProjectKind;
    root: string;
    mode: string;
  } | null;
  operation: OperationName;
  parameters: OperationParameters;
  risk: CapabilityRisk;
  requiredInputs: string[];
  adapter: {
    id: string | null;
    intent: string;
    command: PlannedCommand | null;
    /**
     * Completion contract for the planned command. It tells the agent which
     * milestone marks the work as done and whether the process exits by itself,
     * so waiting never depends on guessing from raw output.
     */
    signals: SignalContract | null;
  };
  execution: {
    availability: CapabilityAvailability;
    approvalRequired: boolean;
    reason: string;
  };
  sourceFingerprint: SourceFingerprint | null;
  toolchain: Array<{
    providerId: string;
    tool: string;
    availability: CapabilityAvailability;
    path: string | null;
    version: string | null;
  }>;
  diagnostics: string[];
}

export async function planOperation(
  workspacePath: string,
  operation: OperationName,
  options: PlanOptions = {},
): Promise<OperationPlan> {
  const inspectOptions =
    options.maxDepth === undefined
      ? {}
      : { maxDepth: options.maxDepth };
  const inspection = await inspectWorkspace(workspacePath, inspectOptions);
  const selected = selectPrimaryProject(inspection, options.projectId);
  const parameters = normalizeParameters(options.parameters ?? {});
  const risk = operationRisk(operation);
  const generatedAt = new Date().toISOString();

  if (selected.project === null || selected.absoluteRoot === null) {
    return {
      schemaVersion: PLAN_SCHEMA_VERSION,
      status: selected.status,
      generatedAt,
      planId: null,
      immutable: true,
      workspace: {
        root: inspection.workspace.root,
        selectedProjectId: null,
        candidateProjectIds: inspection.selection.candidateProjectIds,
      },
      project: null,
      operation,
      parameters,
      risk,
      requiredInputs:
        selected.status === "NEEDS_INPUT" ? ["projectId"] : [],
      adapter: {
        id: null,
        intent: `${operation} the selected app`,
        command: null,
        signals: null,
      },
      execution: {
        availability:
          selected.status === "NEEDS_INPUT"
            ? "needs_input"
            : "unavailable",
        approvalRequired: risk !== "read_only",
        reason: selected.reason,
      },
      sourceFingerprint: null,
      toolchain: [],
      diagnostics: [selected.reason],
    };
  }

  const doctorOptions = {
    projectId: selected.project.id,
    ...(options.maxDepth === undefined
      ? {}
      : { maxDepth: options.maxDepth }),
    ...(options.expoDevServerUrl === undefined
      ? {}
      : { expoDevServerUrl: options.expoDevServerUrl }),
  };
  const [doctor, sourceFingerprint] = await Promise.all([
    doctorWorkspace(inspection.workspace.root, doctorOptions),
    fingerprintDirectory(selected.absoluteRoot),
  ]);
  const adapterPlan = await planForProject(
    selected.project,
    selected.absoluteRoot,
    operation,
    parameters,
  );
  const definition = signalsFor({
    kind: selected.project.kind,
    operation,
  });
  const signals =
    definition === null || adapterPlan.command === null
      ? null
      : signalContract(definition);
  const toolchain = toolchainSnapshot(doctor);
  const requiredInputs = adapterPlan.requiredInputs;
  const status = requiredInputs.length > 0 ? "NEEDS_INPUT" : "VERIFIED";
  const executionAvailability: CapabilityAvailability =
    requiredInputs.length > 0
      ? "needs_input"
      : (adapterPlan.executionAvailability ?? "planned");
  const executionReason =
    requiredInputs.length > 0
      ? `The plan requires: ${requiredInputs.join(", ")}.`
      : (adapterPlan.executionReason ??
        "The plan is immutable, but execution is not implemented for this adapter operation.");

  const hashInput = {
    schemaVersion: PLAN_SCHEMA_VERSION,
    workspaceRoot: inspection.workspace.root,
    project: {
      id: selected.project.id,
      kind: selected.project.kind,
      root: selected.absoluteRoot,
      mode: selected.project.mode,
    },
    operation,
    parameters,
    risk,
    requiredInputs,
    adapter: adapterPlan,
    signals,
    sourceFingerprint,
    toolchain,
  };
  const planId = `plan_${createHash("sha256")
    .update(stableStringify(hashInput))
    .digest("hex")
    .slice(0, 32)}`;

  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    status,
    generatedAt,
    planId,
    immutable: true,
    workspace: {
      root: inspection.workspace.root,
      selectedProjectId: selected.project.id,
      candidateProjectIds: inspection.selection.candidateProjectIds,
    },
    project: {
      id: selected.project.id,
      kind: selected.project.kind,
      root: selected.absoluteRoot,
      mode: selected.project.mode,
    },
    operation,
    parameters,
    risk,
    requiredInputs,
    adapter: {
      id: selected.project.adapter,
      intent: adapterPlan.intent,
      command: adapterPlan.command,
      signals,
    },
    execution: {
      availability: executionAvailability,
      approvalRequired: risk !== "read_only",
      reason: executionReason,
    },
    sourceFingerprint,
    toolchain,
    diagnostics: [
      ...sourceFingerprint.diagnostics,
      ...(adapterPlan.notes ?? []),
    ],
  };
}

function isApplePlatform(platform: string): boolean {
  return ["ios", "ipa", "macos"].includes(platform);
}

export function formatOperationPlan(plan: OperationPlan): string {
  const lines = [
    "RunDocket plan",
    `Status: ${plan.status}`,
    `Plan: ${plan.planId ?? "none"}`,
    `Operation: ${plan.operation}`,
    `Project: ${plan.project?.id ?? "none"}`,
    `Risk: ${plan.risk}`,
    `Execution: ${plan.execution.availability}`,
    `Approval required: ${plan.execution.approvalRequired ? "yes" : "no"}`,
  ];

  if (plan.requiredInputs.length > 0) {
    lines.push(`Required input: ${plan.requiredInputs.join(", ")}`);
  }
  if (plan.adapter.command !== null) {
    lines.push(
      `Command preview: ${[
        plan.adapter.command.executable,
        ...plan.adapter.command.args,
      ].join(" ")}`,
    );
  }
  if (plan.adapter.signals !== null) {
    lines.push(
      `Completion: ${plan.adapter.signals.completion} (${
        plan.adapter.signals.completesOnExit
          ? "the command exits"
          : "the process keeps running afterwards"
      })`,
      `Milestones: ${plan.adapter.signals.expectedMilestones.join(" -> ")}`,
    );
  }
  lines.push(`Reason: ${plan.execution.reason}`);
  return lines.join("\n");
}

interface AdapterPlan {
  intent: string;
  command: PlannedCommand | null;
  requiredInputs: string[];
  notes?: string[] | undefined;
  executionAvailability?: CapabilityAvailability | undefined;
  executionReason?: string | undefined;
}

const EXPO_PLATFORMS = ["ios", "android"] as const;

/**
 * CocoaPods under Ruby 3.4+ aborts with an ASCII-8BIT normalization error when
 * the inherited environment has no UTF-8 locale, which is the common case for
 * a process spawned by an agent runtime rather than an interactive shell.
 */
const APPLE_BUILD_ENV: Record<string, string> = {
  LANG: "en_US.UTF-8",
  LC_ALL: "en_US.UTF-8",
};

async function planForProject(
  project: DetectedProject,
  projectRoot: string,
  operation: OperationName,
  parameters: OperationParameters,
): Promise<AdapterPlan> {
  switch (project.kind) {
    case "expo":
      return planExpo(projectRoot, operation, parameters);
    case "flutter":
      return planFlutter(projectRoot, operation, parameters);
    case "xcode":
      return planXcode(projectRoot, operation, parameters);
  }
}

async function planExpo(
  projectRoot: string,
  operation: OperationName,
  parameters: OperationParameters,
): Promise<AdapterPlan> {
  switch (operation) {
    case "start": {
      const expo = await findProjectBinary(projectRoot, "expo");
      const port = parameters.port ?? 8081;
      return {
        intent: "Start the Expo development server as a managed local process.",
        command:
          expo === null
            ? null
            : {
                executable: expo,
                args: ["start", "--port", String(port)],
                cwd: projectRoot,
                env: { CI: "1" },
              },
        requiredInputs: [],
        executionAvailability:
          expo === null ? "unavailable" : "available",
        executionReason:
          expo === null
            ? "The Expo CLI executable is unavailable."
            : "Expo development-server start is implemented as a managed local process.",
      };
    }
    case "build":
      return planExpoRun(projectRoot, parameters, {
        noBundler: true,
        intent:
          "Build and install the Expo app locally without starting a second development server.",
      });
    case "launch":
      return planExpoRun(projectRoot, parameters, {
        noBundler: false,
        intent:
          "Build, install, and launch the Expo app together with its development server.",
      });
    case "test": {
      const testScript = await packageScript(projectRoot, "test");
      return {
        intent: "Run the Expo project's declared test workflow.",
        command:
          testScript === null
            ? null
            : {
                executable: "npm",
                args: ["test"],
                cwd: projectRoot,
                env: { CI: "1" },
              },
        requiredInputs: testScript === null ? ["testCommand"] : [],
        executionAvailability:
          testScript === null ? "unavailable" : "available",
        executionReason:
          testScript === null
            ? "The Expo project declares no test script."
            : "The declared npm test workflow is executable as a managed local process.",
      };
    }
    case "logs":
      return {
        intent: "Collect Expo app logs through the verified local provider.",
        command: null,
        requiredInputs: [],
      };
  }
}

async function planExpoRun(
  projectRoot: string,
  parameters: OperationParameters,
  options: { noBundler: boolean; intent: string },
): Promise<AdapterPlan> {
  const platform = parameters.platform;
  if (
    platform === undefined ||
    !(EXPO_PLATFORMS as readonly string[]).includes(platform)
  ) {
    return {
      intent: options.intent,
      command: null,
      requiredInputs: ["platform"],
      executionAvailability: "needs_input",
      executionReason: `platform must be one of: ${EXPO_PLATFORMS.join(", ")}.`,
    };
  }

  const expo = await findProjectBinary(projectRoot, "expo");
  const notes: string[] = [];
  const args = [`run:${platform}`];

  if (parameters.deviceId === undefined) {
    notes.push(
      "No deviceId was supplied; Expo selects the target itself, so the evidence cannot bind the run to a device.",
    );
  } else {
    args.push("--device", parameters.deviceId);
  }
  if (parameters.configuration !== undefined) {
    args.push(
      platform === "ios" ? "--configuration" : "--variant",
      parameters.configuration,
    );
  }
  if (options.noBundler) {
    args.push("--no-bundler");
    notes.push(
      "--no-bundler suppresses a second development server; the installed app needs a separately running one at runtime.",
    );
  }
  notes.push(
    "The command keeps running after the app is installed; wait for the completion milestone and cancel the run instead of waiting for process exit.",
  );

  return {
    intent: options.intent,
    command:
      expo === null
        ? null
        : {
            executable: expo,
            args,
            cwd: projectRoot,
            env:
              platform === "ios"
                ? { CI: "1", ...APPLE_BUILD_ENV }
                : { CI: "1" },
          },
    requiredInputs: [],
    notes,
    executionAvailability: expo === null ? "unavailable" : "available",
    executionReason:
      expo === null
        ? "The Expo CLI executable is unavailable."
        : "The local Expo run workflow is executable as a managed local process with a completion contract.",
  };
}

function planFlutter(
  projectRoot: string,
  operation: OperationName,
  parameters: OperationParameters,
): AdapterPlan {
  switch (operation) {
    case "start":
      return {
        intent: "Start a Flutter development run.",
        command: null,
        requiredInputs: [],
        executionAvailability: "planned",
        executionReason:
          "Flutter process lifecycle has not been verified yet.",
      };
    case "build":
      return {
        intent: "Build the Flutter app for a selected platform.",
        command:
          parameters.platform === undefined
            ? null
            : {
                executable: "flutter",
                args: ["build", parameters.platform],
                cwd: projectRoot,
                env: isApplePlatform(parameters.platform)
                  ? { ...APPLE_BUILD_ENV }
                  : {},
              },
        requiredInputs: parameters.platform === undefined ? ["platform"] : [],
      };
    case "test":
      return {
        intent: "Run the Flutter test suite.",
        command: {
          executable: "flutter",
          args: ["test"],
          cwd: projectRoot,
          env: {},
        },
        requiredInputs: [],
      };
    case "launch":
      return {
        intent: "Launch the Flutter app on a selected device.",
        command: {
          executable: "flutter",
          args:
            parameters.deviceId === undefined
              ? ["run"]
              : ["run", "-d", parameters.deviceId],
          cwd: projectRoot,
          env: { ...APPLE_BUILD_ENV },
        },
        requiredInputs: [],
      };
    case "logs":
      return {
        intent: "Collect logs from a Flutter device.",
        command: {
          executable: "flutter",
          args:
            parameters.deviceId === undefined
              ? ["logs"]
              : ["logs", "-d", parameters.deviceId],
          cwd: projectRoot,
          env: {},
        },
        requiredInputs: [],
      };
  }
}

function planXcode(
  projectRoot: string,
  operation: OperationName,
  parameters: OperationParameters,
): AdapterPlan {
  const requiredScheme =
    parameters.scheme === undefined ? ["scheme"] : [];
  const destination =
    parameters.destination === undefined
      ? []
      : ["-destination", parameters.destination];
  const configuration =
    parameters.configuration === undefined
      ? []
      : ["-configuration", parameters.configuration];

  switch (operation) {
    case "start":
      return {
        intent: "Start the native Apple app development lifecycle.",
        command: null,
        requiredInputs: [
          ...requiredScheme,
          ...(parameters.destination === undefined ? ["destination"] : []),
        ],
        executionAvailability: "planned",
        executionReason:
          "Native Apple process lifecycle has not been verified yet.",
      };
    case "build":
      return {
        intent: "Build the selected Xcode scheme.",
        command:
          parameters.scheme === undefined
            ? null
            : {
                executable: "xcodebuild",
                args: [
                  "-scheme",
                  parameters.scheme,
                  ...configuration,
                  ...destination,
                  "build",
                ],
                cwd: projectRoot,
                env: {},
              },
        requiredInputs: requiredScheme,
      };
    case "test":
      return {
        intent: "Test the selected Xcode scheme on an explicit destination.",
        command:
          parameters.scheme === undefined ||
          parameters.destination === undefined
            ? null
            : {
                executable: "xcodebuild",
                args: [
                  "-scheme",
                  parameters.scheme,
                  ...configuration,
                  "-destination",
                  parameters.destination,
                  "test",
                ],
                cwd: projectRoot,
                env: {},
              },
        requiredInputs: [
          ...requiredScheme,
          ...(parameters.destination === undefined ? ["destination"] : []),
        ],
      };
    case "launch":
      return {
        intent: "Launch a verified Xcode build on a selected simulator.",
        command: null,
        requiredInputs: [
          ...requiredScheme,
          ...(parameters.destination === undefined ? ["destination"] : []),
        ],
      };
    case "logs":
      return {
        intent: "Collect simulator logs for the selected app.",
        command: null,
        requiredInputs:
          parameters.destination === undefined ? ["destination"] : [],
      };
  }
}

function operationRisk(operation: OperationName): CapabilityRisk {
  return operation === "logs" ? "read_only" : "local_mutation";
}

function normalizeParameters(
  parameters: OperationParameters,
): OperationParameters {
  const normalized: OperationParameters = {};
  for (const key of [
    "platform",
    "scheme",
    "configuration",
    "destination",
    "deviceId",
  ] as const) {
    const value = parameters[key]?.trim();
    if (value !== undefined && value !== "") {
      normalized[key] = value;
    }
  }
  if (parameters.sources !== undefined) {
    normalized.sources = [...new Set(parameters.sources)].sort();
  }
  if (parameters.port !== undefined) {
    if (
      !Number.isInteger(parameters.port) ||
      parameters.port < 1024 ||
      parameters.port > 65_535
    ) {
      throw new Error("port must be an integer between 1024 and 65535.");
    }
    normalized.port = parameters.port;
  }
  return normalized;
}

async function packageScript(
  projectRoot: string,
  scriptName: string,
): Promise<string | null> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(projectRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, unknown> };
    const script = parsed.scripts?.[scriptName];
    return typeof script === "string" ? script : null;
  } catch {
    return null;
  }
}

function toolchainSnapshot(
  doctor: DoctorResult,
): OperationPlan["toolchain"] {
  return doctor.providers
    .flatMap((provider) =>
      provider.tools.map((tool: ToolProbe) => ({
        providerId: provider.id,
        tool: tool.name,
        availability: tool.availability,
        path: tool.path,
        version: tool.version,
      })),
    )
    .sort((left, right) => {
      const provider = left.providerId.localeCompare(right.providerId);
      return provider !== 0 ? provider : left.tool.localeCompare(right.tool);
    });
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}
