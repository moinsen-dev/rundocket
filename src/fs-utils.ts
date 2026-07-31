import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { InspectDiagnostic } from "./model.js";

const SKIPPED_DIRECTORIES = new Set([
  ".dart_tool",
  ".expo",
  ".git",
  ".idea",
  ".swiftpm",
  "DerivedData",
  "Pods",
  "build",
  "dist",
  "node_modules",
]);

export async function isDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isFile();
  } catch {
    return false;
  }
}

export async function readTextIfFile(
  candidatePath: string,
): Promise<string | null> {
  if (!(await isFile(candidatePath))) {
    return null;
  }

  return readFile(candidatePath, "utf8");
}

export async function resolveWorkspaceRoot(inputPath: string): Promise<string> {
  const resolved = path.resolve(inputPath);

  if (!(await isDirectory(resolved))) {
    throw new Error(`Workspace path is not a directory: ${resolved}`);
  }

  return realpath(resolved);
}

export interface DirectoryWalk {
  directories: string[];
  diagnostics: InspectDiagnostic[];
}

export async function walkDirectories(
  root: string,
  maxDepth: number,
): Promise<DirectoryWalk> {
  const directories: string[] = [];
  const diagnostics: InspectDiagnostic[] = [];
  const queue: Array<{ directory: string; depth: number }> = [
    { directory: root, depth: 0 },
  ];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }

    directories.push(current.directory);

    if (current.depth >= maxDepth) {
      continue;
    }

    let entries;
    try {
      entries = await readdir(current.directory, { withFileTypes: true });
    } catch (error) {
      diagnostics.push({
        level: "warning",
        code: "DIRECTORY_UNREADABLE",
        path: relativePath(root, current.directory),
        message: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const childDirectories = entries
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !SKIPPED_DIRECTORIES.has(entry.name))
      .filter(
        (entry) =>
          !entry.name.endsWith(".xcodeproj") &&
          !entry.name.endsWith(".xcworkspace"),
      )
      .filter((entry) => !entry.name.startsWith("."))
      .map((entry) => path.join(current.directory, entry.name))
      .sort((left, right) => left.localeCompare(right));

    for (const directory of childDirectories) {
      queue.push({ directory, depth: current.depth + 1 });
    }
  }

  return { directories, diagnostics };
}

export function relativePath(root: string, target: string): string {
  const relative = path.relative(root, target);
  return (relative === "" ? "." : relative).split(path.sep).join("/");
}

export function isWithinOrSame(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
