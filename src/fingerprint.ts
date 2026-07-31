import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SKIPPED_DIRECTORIES = new Set([
  ".dart_tool",
  ".expo",
  ".git",
  ".idea",
  ".swiftpm",
  "DerivedData",
  "Pods",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

const MAX_FILES = 20_000;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

export interface SourceFingerprint {
  algorithm: "sha256";
  value: string;
  fileCount: number;
  byteCount: number;
  complete: boolean;
  diagnostics: string[];
}

export async function fingerprintDirectory(
  inputRoot: string,
): Promise<SourceFingerprint> {
  const root = path.resolve(inputRoot);
  const hash = createHash("sha256");
  const diagnostics: string[] = [];
  let fileCount = 0;
  let byteCount = 0;
  let complete = true;

  const visit = async (directory: string): Promise<void> => {
    if (fileCount >= MAX_FILES || byteCount >= MAX_TOTAL_BYTES) {
      complete = false;
      return;
    }

    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      complete = false;
      diagnostics.push(
        `Unreadable directory ${normalize(path.relative(root, directory))}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (fileCount >= MAX_FILES || byteCount >= MAX_TOTAL_BYTES) {
        complete = false;
        break;
      }

      const absolutePath = path.join(directory, entry.name);
      const relative = normalize(path.relative(root, absolutePath));

      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await visit(absolutePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        complete = false;
        diagnostics.push(`Skipped non-file entry ${relative}.`);
        continue;
      }

      try {
        const metadata = await stat(absolutePath);
        fileCount += 1;
        byteCount += metadata.size;
        hash.update(relative);
        hash.update("\0");
        hash.update(String(metadata.size));
        hash.update("\0");

        if (
          metadata.size > MAX_FILE_BYTES ||
          byteCount > MAX_TOTAL_BYTES
        ) {
          complete = false;
          diagnostics.push(`Hashed metadata only for large file ${relative}.`);
          hash.update(String(metadata.mtimeMs));
        } else {
          hash.update(await readFile(absolutePath));
        }
        hash.update("\0");
      } catch (error) {
        complete = false;
        diagnostics.push(
          `Unreadable file ${relative}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  };

  await visit(root);

  if (fileCount >= MAX_FILES) {
    diagnostics.push(`Fingerprint stopped at ${MAX_FILES} files.`);
  }
  if (byteCount >= MAX_TOTAL_BYTES) {
    diagnostics.push(
      `Fingerprint stopped at ${MAX_TOTAL_BYTES} source bytes.`,
    );
  }

  return {
    algorithm: "sha256",
    value: hash.digest("hex"),
    fileCount,
    byteCount,
    complete,
    diagnostics,
  };
}

function normalize(relativePath: string): string {
  return (relativePath || ".").split(path.sep).join("/");
}
