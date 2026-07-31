#!/usr/bin/env node

import { parseArgs } from "node:util";

import { doctorWorkspace, formatDoctorResult } from "./doctor.js";
import { inspectWorkspace } from "./discovery.js";
import { formatInspectResult } from "./format.js";
import { serveRunDocketMcp } from "./mcp.js";
import {
  EXIT_CODES,
  type InspectFailure,
  type InspectStatus,
} from "./model.js";
import {
  formatOperationPlan,
  planOperation,
  type OperationName,
  type OperationParameters,
} from "./plan.js";
import { RUNDOCKET_VERSION } from "./version.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (
    command === undefined ||
    command === "help" ||
    command === "--help" ||
    command === "-h"
  ) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  if (command === "--version" || command === "-V") {
    process.stdout.write(`${RUNDOCKET_VERSION}\n`);
    return;
  }

  switch (command) {
    case "inspect":
      await runInspect(argv.slice(1));
      return;
    case "doctor":
      await runDoctor(argv.slice(1));
      return;
    case "plan":
      await runPlan(argv.slice(1));
      return;
    case "mcp":
      runMcp(argv.slice(1));
      return;
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

async function runInspect(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      json: {
        type: "boolean",
        default: false,
      },
      "max-depth": {
        type: "string",
        default: "4",
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
    },
    allowPositionals: true,
    strict: true,
  });

  if (parsed.values.help) {
    process.stdout.write(`${inspectHelpText()}\n`);
    return;
  }
  if (parsed.positionals.length > 1) {
    throw new UsageError("inspect accepts at most one workspace path.");
  }

  const maxDepth = parseMaxDepth(parsed.values["max-depth"]);
  const targetPath = parsed.positionals[0] ?? process.cwd();
  const result = await inspectWorkspace(targetPath, { maxDepth });

  writeResult(result, formatInspectResult(result), parsed.values.json);
  process.exitCode = exitCodeForStatus(result.status);
}

async function runDoctor(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      json: {
        type: "boolean",
        default: false,
      },
      "max-depth": {
        type: "string",
        default: "4",
      },
      project: {
        type: "string",
      },
      "expo-dev-server-url": {
        type: "string",
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
    },
    allowPositionals: true,
    strict: true,
  });

  if (parsed.values.help) {
    process.stdout.write(`${doctorHelpText()}\n`);
    return;
  }
  if (parsed.positionals.length > 1) {
    throw new UsageError("doctor accepts at most one workspace path.");
  }

  const targetPath = parsed.positionals[0] ?? process.cwd();
  const result = await doctorWorkspace(
    targetPath,
    compact({
      maxDepth: parseMaxDepth(parsed.values["max-depth"]),
      projectId: parsed.values.project,
      expoDevServerUrl: parsed.values["expo-dev-server-url"],
    }),
  );

  writeResult(result, formatDoctorResult(result), parsed.values.json);
  process.exitCode = exitCodeForStatus(result.status);
}

async function runPlan(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      json: {
        type: "boolean",
        default: false,
      },
      "max-depth": {
        type: "string",
        default: "4",
      },
      project: {
        type: "string",
      },
      "expo-dev-server-url": {
        type: "string",
      },
      platform: {
        type: "string",
      },
      scheme: {
        type: "string",
      },
      configuration: {
        type: "string",
      },
      destination: {
        type: "string",
      },
      "device-id": {
        type: "string",
      },
      port: {
        type: "string",
      },
      source: {
        type: "string",
        multiple: true,
      },
      help: {
        type: "boolean",
        short: "h",
        default: false,
      },
    },
    allowPositionals: true,
    strict: true,
  });

  if (parsed.values.help) {
    process.stdout.write(`${planHelpText()}\n`);
    return;
  }
  if (parsed.positionals.length < 1 || parsed.positionals.length > 2) {
    throw new UsageError(
      "plan requires an operation and accepts at most one workspace path.",
    );
  }

  const operation = parseOperation(parsed.positionals[0]);
  const targetPath = parsed.positionals[1] ?? process.cwd();
  const parameters: OperationParameters = compact({
    platform: parsed.values.platform,
    scheme: parsed.values.scheme,
    configuration: parsed.values.configuration,
    destination: parsed.values.destination,
    deviceId: parsed.values["device-id"],
    sources: parsed.values.source,
    port:
      parsed.values.port === undefined
        ? undefined
        : parsePort(parsed.values.port),
  });
  const result = await planOperation(
    targetPath,
    operation,
    compact({
      maxDepth: parseMaxDepth(parsed.values["max-depth"]),
      projectId: parsed.values.project,
      expoDevServerUrl: parsed.values["expo-dev-server-url"],
      parameters,
    }),
  );

  writeResult(result, formatOperationPlan(result), parsed.values.json);
  process.exitCode = exitCodeForStatus(result.status);
}

function runMcp(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`${mcpHelpText()}\n`);
    return;
  }
  if (args.length > 0) {
    throw new UsageError("mcp does not accept positional arguments.");
  }
  serveRunDocketMcp();
}

function writeResult(
  value: unknown,
  formatted: string,
  json: boolean,
): void {
  process.stdout.write(
    json ? `${JSON.stringify(value, null, 2)}\n` : `${formatted}\n`,
  );
}

function parseOperation(value: string | undefined): OperationName {
  if (
    value === "start" ||
    value === "build" ||
    value === "test" ||
    value === "launch" ||
    value === "logs"
  ) {
    return value;
  }
  throw new UsageError(
    "operation must be one of: start, build, test, launch, logs.",
  );
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
    throw new UsageError("--port must be an integer between 1024 and 65535.");
  }
  return port;
}

function parseMaxDepth(value: string | undefined): number {
  const maxDepth = Number(value ?? "4");
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 12) {
    throw new UsageError("--max-depth must be an integer between 0 and 12.");
  }
  return maxDepth;
}

function exitCodeForStatus(status: Exclude<InspectStatus, "FAILED">): number {
  return EXIT_CODES[status];
}

function helpText(): string {
  return `RunDocket ${RUNDOCKET_VERSION}

AI-first, framework-adaptive execution layer for app development.

Usage:
  rundocket inspect [path] [--json] [--max-depth <0-12>]
  rundocket doctor [path] [--json] [--project <id>]
  rundocket plan <start|build|test|launch|logs> [path] [options]
  rundocket mcp
  rundocket --version
  rundocket --help

Implemented:
  inspect    Read-only Xcode, Flutter, and Expo workspace discovery
  doctor     Read-only toolchain, provider, server, and device readiness
  plan       Immutable, source-bound operation plans without execution
  mcp        Headless stdio MCP server

Default-deny:
  unverified apply operations, signing, upload, store submission, and release`;
}

function inspectHelpText(): string {
  return `Usage:
  rundocket inspect [path] [--json] [--max-depth <0-12>]

Options:
  --json              Emit the versioned machine contract
  --max-depth <n>     Directory discovery depth (default: 4)
  -h, --help          Show this help`;
}

function doctorHelpText(): string {
  return `Usage:
  rundocket doctor [path] [options]

Options:
  --json                         Emit the versioned machine contract
  --max-depth <n>                Directory discovery depth (default: 4)
  --project <id>                 Select one primary project in a monorepo
  --expo-dev-server-url <url>    Use an explicit loopback Expo server
  -h, --help                     Show this help`;
}

function planHelpText(): string {
  return `Usage:
  rundocket plan <start|build|test|launch|logs> [path] [options]

Options:
  --json                         Emit the versioned machine contract
  --max-depth <n>                Directory discovery depth (default: 4)
  --project <id>                 Select one primary project in a monorepo
  --expo-dev-server-url <url>    Bind a loopback Expo development server
  --platform <name>              Target platform
  --scheme <name>                Xcode scheme
  --configuration <name>         Build configuration
  --destination <value>          Xcode destination
  --device-id <id>               Flutter or device target
  --port <1024-65535>             Local development-server port
  --source <name>                Log source; may be repeated
  -h, --help                     Show this help`;
}

function mcpHelpText(): string {
  return `Usage:
  rundocket mcp

Starts the headless RunDocket MCP server over stdio. Protocol output is written
only to stdout; diagnostics are written to stderr.`;
}

class UsageError extends Error {}

function compact<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

main().catch((error: unknown) => {
  const isUsageError =
    error instanceof UsageError ||
    (error instanceof TypeError && error.message.includes("Unknown option"));
  const message = error instanceof Error ? error.message : String(error);
  const wantsJson = process.argv.includes("--json");

  if (wantsJson) {
    const failureCode = isUsageError
      ? "USAGE_ERROR"
      : process.argv[2] === "inspect"
        ? "INSPECTION_FAILED"
        : "COMMAND_FAILED";
    const failure: InspectFailure = {
      schemaVersion: "rundocket.error.v1",
      status: "FAILED",
      error: {
        code: failureCode,
        message,
      },
    };
    process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  } else {
    process.stderr.write(`RunDocket: ${message}\n`);
    if (isUsageError) {
      process.stderr.write("Run 'rundocket --help' for usage.\n");
    }
  }

  process.exitCode = isUsageError ? EXIT_CODES.USAGE : EXIT_CODES.FAILED;
});
