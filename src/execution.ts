import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { fingerprintDirectory } from "./fingerprint.js";
import { planOperation, type OperationPlan } from "./plan.js";

export const RUN_SCHEMA_VERSION = "rundocket.run.v1" as const;
export const EVIDENCE_SCHEMA_VERSION =
  "rundocket.evidence.v1" as const;

export type RunState =
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface RunSnapshot {
  schemaVersion: typeof RUN_SCHEMA_VERSION;
  generatedAt: string;
  runId: string;
  planId: string;
  operation: string;
  state: RunState;
  startedAt: string;
  endedAt: string | null;
  pid: number | null;
  command: {
    executable: string;
    args: string[];
    cwd: string;
  };
  result: {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    cancellationRequested: boolean;
    durationMs: number | null;
  };
  output: {
    stdout: string;
    stderr: string;
    truncated: boolean;
  };
  evidence: {
    sourceFingerprintAtPlan: string;
    sourceFingerprintAtApply: string;
    sourceFingerprintComplete: boolean;
  };
}

export interface RunEvidence {
  schemaVersion: typeof EVIDENCE_SCHEMA_VERSION;
  generatedAt: string;
  plan: OperationPlan;
  run: RunSnapshot;
  freshness: {
    status: "fresh" | "stale" | "unverified";
    currentSourceFingerprint: string | null;
    reason: string;
  };
}

interface MutableRun {
  runId: string;
  plan: OperationPlan;
  state: RunState;
  startedAt: string;
  endedAt: string | null;
  child: ChildProcess;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  cancellationRequested: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  sourceFingerprintAtApply: string;
  completion: Promise<void>;
}

export class ExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class ExecutionManager {
  private readonly plans = new Map<string, OperationPlan>();
  private readonly runs = new Map<string, MutableRun>();

  rememberPlan(plan: OperationPlan): void {
    if (plan.planId === null) {
      return;
    }
    this.plans.set(plan.planId, structuredClone(plan));
  }

  async apply(planId: string, approved: boolean): Promise<RunSnapshot> {
    const remembered = this.plans.get(planId);
    if (remembered === undefined) {
      throw new ExecutionError(
        "PLAN_NOT_FOUND",
        "The plan is not registered in this MCP session. Call operation_plan first.",
      );
    }
    if (remembered.risk !== "read_only" && !approved) {
      throw new ExecutionError(
        "NEEDS_APPROVAL",
        "This local mutation requires approved=true.",
      );
    }
    if (remembered.execution.availability !== "available") {
      throw new ExecutionError(
        "EXECUTION_UNAVAILABLE",
        remembered.execution.reason,
      );
    }
    if (remembered.project === null || remembered.planId === null) {
      throw new ExecutionError(
        "INVALID_PLAN",
        "The plan does not contain an executable selected project.",
      );
    }

    const fresh = await planOperation(
      remembered.workspace.root,
      remembered.operation,
      {
        projectId: remembered.project.id,
        parameters: remembered.parameters,
      },
    );
    if (fresh.planId !== remembered.planId) {
      throw new ExecutionError(
        "STALE_PLAN",
        `Plan ${remembered.planId} no longer matches the workspace; current plan is ${fresh.planId ?? "unavailable"}.`,
      );
    }
    if (
      fresh.operation !== "start" ||
      fresh.project?.kind !== "expo" ||
      fresh.adapter.command === null
    ) {
      throw new ExecutionError(
        "EXECUTION_NOT_IMPLEMENTED",
        "Only verified Expo development-server start is executable in this phase.",
      );
    }

    const port = fresh.parameters.port ?? 8081;
    if (await isPortListening(port)) {
      throw new ExecutionError(
        "PORT_IN_USE",
        `Loopback port ${port} is already in use.`,
      );
    }

    const command = fresh.adapter.command;
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: {
        ...process.env,
        CI: process.env.CI ?? "1",
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const runId = `run_${randomUUID()}`;
    let settleCompletion: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });
    const run: MutableRun = {
      runId,
      plan: fresh,
      state: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      child,
      exitCode: null,
      signal: null,
      cancellationRequested: false,
      stdout: "",
      stderr: "",
      truncated: false,
      sourceFingerprintAtApply:
        fresh.sourceFingerprint?.value ?? "unavailable",
      completion,
    };
    this.runs.set(runId, run);

    child.stdout?.on("data", (chunk: Buffer) => {
      appendOutput(run, "stdout", chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      appendOutput(run, "stderr", chunk);
    });
    child.once("error", (error) => {
      appendOutput(run, "stderr", Buffer.from(`${error.message}\n`));
      run.state = run.cancellationRequested ? "cancelled" : "failed";
      run.endedAt = new Date().toISOString();
      settleCompletion?.();
    });
    child.once("close", (exitCode, signal) => {
      run.exitCode = exitCode;
      run.signal = signal;
      run.state = run.cancellationRequested
        ? "cancelled"
        : exitCode === 0
          ? "succeeded"
          : "failed";
      run.endedAt = new Date().toISOString();
      settleCompletion?.();
    });

    await new Promise<void>((resolve) => {
      child.once("spawn", resolve);
      child.once("error", resolve);
    });

    return snapshot(run);
  }

  status(runId: string): RunSnapshot {
    return snapshot(this.requireRun(runId));
  }

  async evidence(runId: string): Promise<RunEvidence> {
    const run = this.requireRun(runId);
    const projectRoot = run.plan.project?.root;
    let freshness: RunEvidence["freshness"];
    if (projectRoot === undefined) {
      freshness = {
        status: "unverified",
        currentSourceFingerprint: null,
        reason: "The plan has no selected project root.",
      };
    } else {
      try {
        const current = await fingerprintDirectory(projectRoot);
        const planned =
          run.plan.sourceFingerprint?.value ?? "unavailable";
        freshness = {
          status: current.value === planned ? "fresh" : "stale",
          currentSourceFingerprint: current.value,
          reason:
            current.value === planned
              ? "Current relevant sources match the applied plan."
              : "Relevant source inputs changed after the plan was applied.",
        };
      } catch (error) {
        freshness = {
          status: "unverified",
          currentSourceFingerprint: null,
          reason:
            error instanceof Error ? error.message : String(error),
        };
      }
    }
    return {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      plan: structuredClone(run.plan),
      run: snapshot(run),
      freshness,
    };
  }

  async cancel(runId: string): Promise<RunSnapshot> {
    const run = this.requireRun(runId);
    if (isTerminal(run.state)) {
      return snapshot(run);
    }

    run.cancellationRequested = true;
    run.state = "cancelling";
    signalRun(run, "SIGTERM");

    const forceTimer = setTimeout(() => {
      if (!isTerminal(run.state)) {
        signalRun(run, "SIGKILL");
      }
    }, 3_000);
    forceTimer.unref();

    await Promise.race([
      run.completion,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1_000);
        timer.unref();
      }),
    ]);
    return snapshot(run);
  }

  async shutdown(): Promise<void> {
    const active = [...this.runs.values()].filter(
      (run) => !isTerminal(run.state),
    );
    await Promise.all(
      active.map(async (run) => {
        await this.cancel(run.runId).catch(() => undefined);
      }),
    );
  }

  private requireRun(runId: string): MutableRun {
    const run = this.runs.get(runId);
    if (run === undefined) {
      throw new ExecutionError(
        "RUN_NOT_FOUND",
        `Unknown run ID: ${runId}`,
      );
    }
    return run;
  }
}

function snapshot(run: MutableRun): RunSnapshot {
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runId: run.runId,
    planId: run.plan.planId ?? "unavailable",
    operation: run.plan.operation,
    state: run.state,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    pid: run.child.pid ?? null,
    command: {
      executable: run.plan.adapter.command?.executable ?? "unavailable",
      args: run.plan.adapter.command?.args ?? [],
      cwd: run.plan.adapter.command?.cwd ?? run.plan.workspace.root,
    },
    result: {
      exitCode: run.exitCode,
      signal: run.signal,
      cancellationRequested: run.cancellationRequested,
      durationMs:
        run.endedAt === null
          ? Date.now() - Date.parse(run.startedAt)
          : Date.parse(run.endedAt) - Date.parse(run.startedAt),
    },
    output: {
      stdout: run.stdout,
      stderr: run.stderr,
      truncated: run.truncated,
    },
    evidence: {
      sourceFingerprintAtPlan:
        run.plan.sourceFingerprint?.value ?? "unavailable",
      sourceFingerprintAtApply: run.sourceFingerprintAtApply,
      sourceFingerprintComplete:
        run.plan.sourceFingerprint?.complete ?? false,
    },
  };
}

function appendOutput(
  run: MutableRun,
  stream: "stdout" | "stderr",
  chunk: Buffer,
): void {
  const maxBytes = 128 * 1024;
  const current = run[stream];
  const combined = current + chunk.toString("utf8");
  if (Buffer.byteLength(combined) <= maxBytes) {
    run[stream] = combined;
    return;
  }

  run.truncated = true;
  const buffer = Buffer.from(combined);
  run[stream] = buffer.subarray(buffer.byteLength - maxBytes).toString("utf8");
}

function signalRun(run: MutableRun, signal: NodeJS.Signals): void {
  try {
    if (
      process.platform !== "win32" &&
      run.child.pid !== undefined
    ) {
      process.kill(-run.child.pid, signal);
    } else {
      run.child.kill(signal);
    }
  } catch {
    run.child.kill(signal);
  }
}

function isTerminal(state: RunState): boolean {
  return ["succeeded", "failed", "cancelled"].includes(state);
}

async function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      host: "127.0.0.1",
      port,
    });
    const finish = (listening: boolean): void => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}
