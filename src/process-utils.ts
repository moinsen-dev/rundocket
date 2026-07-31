import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

export interface CommandResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  error: string | null;
}

export interface RunCommandOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

export async function runCommand(
  command: string,
  args: string[],
  options: RunCommandOptions = {},
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  const maxOutputBytes = options.maxOutputBytes ?? 32_768;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const spawnOptions: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      stdio: ["ignore", "pipe", "pipe"];
    } = {
      stdio: ["ignore", "pipe", "pipe"],
    };
    if (options.cwd !== undefined) {
      spawnOptions.cwd = options.cwd;
    }
    if (options.env !== undefined) {
      spawnOptions.env = options.env;
    }

    const child = spawn(command, args, spawnOptions);

    const append = (current: string, chunk: Buffer): string => {
      if (Buffer.byteLength(current) >= maxOutputBytes) {
        truncated = true;
        return current;
      }

      const remaining = maxOutputBytes - Buffer.byteLength(current);
      if (chunk.byteLength > remaining) {
        truncated = true;
        return current + chunk.subarray(0, remaining).toString("utf8");
      }
      return current + chunk.toString("utf8");
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });

    const finish = (
      exitCode: number | null,
      signal: NodeJS.Signals | null,
      error: string | null,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        args,
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        truncated,
        error,
      });
    };

    child.on("error", (error) => {
      finish(null, null, error.message);
    });
    child.on("close", (exitCode, signal) => {
      finish(exitCode, signal, null);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      const forceTimer = setTimeout(() => {
        child.kill("SIGKILL");
      }, 500);
      forceTimer.unref();
    }, timeoutMs);
    timer.unref();
  });
}

export async function findExecutable(name: string): Promise<string | null> {
  if (name.includes(path.sep) || path.isAbsolute(name)) {
    return (await isExecutable(name)) ? path.resolve(name) : null;
  }

  const pathValue = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT")
          .split(";")
          .filter(Boolean)
      : [""];

  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

export async function findProjectBinary(
  projectRoot: string,
  name: string,
): Promise<string | null> {
  return (
    (await findLocalProjectBinary(projectRoot, name)) ??
    findExecutable(name)
  );
}

export async function findLocalProjectBinary(
  projectRoot: string,
  name: string,
): Promise<string | null> {
  let directory = path.resolve(projectRoot);
  const filesystemRoot = path.parse(directory).root;

  while (true) {
    const suffix = process.platform === "win32" ? `${name}.cmd` : name;
    const candidate = path.join(directory, "node_modules", ".bin", suffix);
    if (await isExecutable(candidate)) {
      return candidate;
    }

    if (directory === filesystemRoot) {
      break;
    }
    directory = path.dirname(directory);
  }

  return null;
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(
      candidate,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}
