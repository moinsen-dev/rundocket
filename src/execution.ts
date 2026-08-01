import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

import { fingerprintDirectory } from "./fingerprint.js";
import { planOperation, type OperationPlan } from "./plan.js";
import {
  classifyLine,
  milestoneRank,
  signalsFor,
  type DiagnosticRecord,
  type MilestoneName,
  type MilestoneRecord,
  type SignalDefinition,
} from "./signals.js";

export const RUN_SCHEMA_VERSION = "rundocket.run.v2" as const;
export const EVIDENCE_SCHEMA_VERSION =
  "rundocket.evidence.v2" as const;
export const AWAIT_SCHEMA_VERSION = "rundocket.await.v1" as const;

const OUTPUT_HEAD_BYTES = 32 * 1024;
const OUTPUT_TAIL_BYTES = 96 * 1024;
const MAX_DIAGNOSTICS = 40;
const DEFAULT_AWAIT_TIMEOUT_MS = 300_000;
const MAX_AWAIT_TIMEOUT_MS = 3_600_000;

const EXECUTABLE_EXPO_OPERATIONS = new Set([
  "start",
  "build",
  "launch",
  "test",
]);

export type RunState =
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

/** What a caller can wait for: a milestone, the completion contract, or exit. */
export type AwaitTarget = MilestoneName | "completion" | "exit";

export type AwaitOutcome =
  | "completed"
  | "failed"
  | "exited"
  | "cancelled"
  | "timeout";

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
    env: Record<string, string>;
  };
  lifecycle: {
    phase: MilestoneName;
    milestones: MilestoneRecord[];
    completion: {
      expected: MilestoneName | null;
      completesOnExit: boolean;
      reached: boolean;
      at: string | null;
      /**
       * True when the requested work is done but the process intentionally
       * keeps running. Waiting for process exit here would never return.
       */
      processOutlivesCompletion: boolean;
    };
  };
  diagnostics: DiagnosticRecord[];
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
    omittedBytes: number;
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

export interface RunAwaitResult {
  schemaVersion: typeof AWAIT_SCHEMA_VERSION;
  generatedAt: string;
  outcome: AwaitOutcome;
  target: AwaitTarget;
  waitedMs: number;
  /** The diagnostic that ended the wait, when the outcome is `failed`. */
  cause: DiagnosticRecord | null;
  run: RunSnapshot;
}

export interface AwaitOptions {
  until?: AwaitTarget | undefined;
  timeoutMs?: number | undefined;
}

interface Waiter {
  settled: boolean;
  check: () => boolean;
  resolve: () => void;
}

interface MutableRun {
  runId: string;
  plan: OperationPlan;
  signals: SignalDefinition | null;
  state: RunState;
  startedAt: string;
  endedAt: string | null;
  child: ChildProcess;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  cancellationRequested: boolean;
  stdout: BoundedStream;
  stderr: BoundedStream;
  phase: MilestoneName;
  milestones: MilestoneRecord[];
  diagnostics: DiagnosticRecord[];
  fatalDiagnostic: DiagnosticRecord | null;
  completionAt: string | null;
  sourceFingerprintAtApply: string;
  completion: Promise<void>;
  waiters: Set<Waiter>;
}

export class ExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Keeps the beginning and the end of a stream. Build failures usually name
 * their cause near the start and repeat only follow-up noise at the end, so a
 * tail-only buffer drops the one part an agent needs.
 */
class BoundedStream {
  private head = "";
  private tail = "";
  private omitted = 0;
  private pending = "";

  /** Returns the complete lines contained in the appended chunk. */
  append(chunk: string): string[] {
    const lines = this.takeLines(chunk);
    this.store(chunk);
    return lines;
  }

  private store(chunk: string): void {
    const headRoom = OUTPUT_HEAD_BYTES - Buffer.byteLength(this.head);
    if (headRoom > 0) {
      const taken = chunk.slice(0, headRoom);
      this.head += taken;
      chunk = chunk.slice(taken.length);
      if (chunk === "") {
        return;
      }
    }

    this.tail += chunk;
    const overflow = Buffer.byteLength(this.tail) - OUTPUT_TAIL_BYTES;
    if (overflow > 0) {
      const buffer = Buffer.from(this.tail);
      this.tail = buffer.subarray(overflow).toString("utf8");
      this.omitted += overflow;
    }
  }

  private takeLines(chunk: string): string[] {
    this.pending += chunk;
    const parts = this.pending.split("\n");
    this.pending = parts.pop() ?? "";
    return parts;
  }

  get truncated(): boolean {
    return this.omitted > 0;
  }

  get omittedBytes(): number {
    return this.omitted;
  }

  render(): string {
    if (this.omitted === 0) {
      return this.head + this.tail;
    }
    return `${this.head}\n...[${this.omitted} bytes omitted]...\n${this.tail}`;
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
      fresh.project?.kind !== "expo" ||
      !EXECUTABLE_EXPO_OPERATIONS.has(fresh.operation) ||
      fresh.adapter.command === null
    ) {
      throw new ExecutionError(
        "EXECUTION_NOT_IMPLEMENTED",
        "Only verified Expo start, build, launch, and test operations are executable in this phase.",
      );
    }

    if (fresh.operation === "start") {
      const port = fresh.parameters.port ?? 8081;
      if (await isPortListening(port)) {
        throw new ExecutionError(
          "PORT_IN_USE",
          `Loopback port ${port} is already in use.`,
        );
      }
    }

    const command = fresh.adapter.command;
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: {
        ...process.env,
        ...command.env,
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const runId = `run_${randomUUID()}`;
    const startedAt = new Date().toISOString();
    let settleCompletion: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      settleCompletion = resolve;
    });
    const run: MutableRun = {
      runId,
      plan: fresh,
      signals: signalsFor({
        kind: fresh.project.kind,
        operation: fresh.operation,
      }),
      state: "running",
      startedAt,
      endedAt: null,
      child,
      exitCode: null,
      signal: null,
      cancellationRequested: false,
      stdout: new BoundedStream(),
      stderr: new BoundedStream(),
      phase: "starting",
      milestones: [
        {
          name: "starting",
          at: startedAt,
          evidence: "managed process spawned",
        },
      ],
      diagnostics: [],
      fatalDiagnostic: null,
      completionAt: null,
      sourceFingerprintAtApply:
        fresh.sourceFingerprint?.value ?? "unavailable",
      completion,
      waiters: new Set(),
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
      notify(run);
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
      if (
        run.state === "succeeded" &&
        run.signals?.completesOnExit === true &&
        run.completionAt === null
      ) {
        run.completionAt = run.endedAt;
      }
      settleCompletion?.();
      notify(run);
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

  /**
   * Resolves as soon as there is something to report: the requested milestone,
   * a fatal diagnostic, process exit, or the timeout. This replaces polling and
   * removes the need for a caller to interpret raw build output.
   */
  async awaitRun(
    runId: string,
    options: AwaitOptions = {},
  ): Promise<RunAwaitResult> {
    const run = this.requireRun(runId);
    const target: AwaitTarget = options.until ?? "completion";
    if (
      target !== "completion" &&
      target !== "exit" &&
      milestoneRank(target) < 0
    ) {
      throw new ExecutionError(
        "INVALID_AWAIT_TARGET",
        `Unknown await target: ${target}`,
      );
    }
    if (
      target === "completion" &&
      run.signals === null &&
      !isTerminal(run.state)
    ) {
      throw new ExecutionError(
        "NO_COMPLETION_CONTRACT",
        "This operation has no completion contract; wait for `exit` or a milestone instead.",
      );
    }

    const timeoutMs = Math.min(
      Math.max(options.timeoutMs ?? DEFAULT_AWAIT_TIMEOUT_MS, 1_000),
      MAX_AWAIT_TIMEOUT_MS,
    );
    const startedAt = Date.now();
    const satisfied = (): boolean =>
      isTerminal(run.state) ||
      run.fatalDiagnostic !== null ||
      reachedTarget(run, target);

    if (!satisfied()) {
      await new Promise<void>((resolve) => {
        const waiter: Waiter = {
          settled: false,
          check: satisfied,
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
        };
        const timer = setTimeout(() => {
          waiter.settled = true;
          run.waiters.delete(waiter);
          resolve();
        }, timeoutMs);
        timer.unref();
        run.waiters.add(waiter);
      });
    }

    return {
      schemaVersion: AWAIT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      outcome: awaitOutcome(run, target),
      target,
      waitedMs: Date.now() - startedAt,
      cause: run.fatalDiagnostic,
      run: snapshot(run),
    };
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

function reachedTarget(run: MutableRun, target: AwaitTarget): boolean {
  if (target === "exit") {
    return isTerminal(run.state);
  }
  if (target === "completion") {
    return run.completionAt !== null;
  }
  return milestoneRank(run.phase) >= milestoneRank(target);
}

function awaitOutcome(
  run: MutableRun,
  target: AwaitTarget,
): AwaitOutcome {
  if (run.state === "cancelled") {
    return "cancelled";
  }
  if (run.fatalDiagnostic !== null || run.state === "failed") {
    return "failed";
  }
  if (reachedTarget(run, target)) {
    return "completed";
  }
  if (isTerminal(run.state)) {
    return "exited";
  }
  return "timeout";
}

function snapshot(run: MutableRun): RunSnapshot {
  const expected = run.signals?.completion ?? null;
  const reached = run.completionAt !== null;
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
      env: run.plan.adapter.command?.env ?? {},
    },
    lifecycle: {
      phase: run.phase,
      milestones: [...run.milestones],
      completion: {
        expected,
        completesOnExit: run.signals?.completesOnExit ?? false,
        reached,
        at: run.completionAt,
        processOutlivesCompletion:
          reached &&
          run.signals?.completesOnExit === false &&
          !isTerminal(run.state),
      },
    },
    diagnostics: [...run.diagnostics],
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
      stdout: run.stdout.render(),
      stderr: run.stderr.render(),
      truncated: run.stdout.truncated || run.stderr.truncated,
      omittedBytes: run.stdout.omittedBytes + run.stderr.omittedBytes,
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
  const lines = run[stream].append(chunk.toString("utf8"));
  if (run.signals === null || lines.length === 0) {
    return;
  }

  let changed = false;
  for (const line of lines) {
    const { milestone, diagnostic } = classifyLine(run.signals, line);
    if (
      milestone !== null &&
      milestoneRank(milestone) > milestoneRank(run.phase)
    ) {
      run.phase = milestone;
      run.milestones.push({
        name: milestone,
        at: new Date().toISOString(),
        evidence: line.trim().slice(0, 300),
      });
      changed = true;
      // A command that is expected to exit is only done once it has exited:
      // reaching the milestone still leaves teardown and the exit code open.
      if (
        run.completionAt === null &&
        !run.signals.completesOnExit &&
        milestoneRank(milestone) >= milestoneRank(run.signals.completion)
      ) {
        run.completionAt = new Date().toISOString();
      }
    }
    if (diagnostic !== null) {
      if (run.diagnostics.length < MAX_DIAGNOSTICS) {
        run.diagnostics.push({
          ...diagnostic,
          at: new Date().toISOString(),
        });
      }
      if (diagnostic.fatal && run.fatalDiagnostic === null) {
        run.fatalDiagnostic = {
          ...diagnostic,
          at: new Date().toISOString(),
        };
        changed = true;
      }
    }
  }

  if (changed) {
    notify(run);
  }
}

function notify(run: MutableRun): void {
  for (const waiter of [...run.waiters]) {
    if (waiter.settled) {
      run.waiters.delete(waiter);
      continue;
    }
    if (waiter.check()) {
      waiter.settled = true;
      run.waiters.delete(waiter);
      waiter.resolve();
    }
  }
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
