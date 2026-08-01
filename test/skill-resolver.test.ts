import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const manifest = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
) as { version: string };
const resolverPath = join(
  repositoryRoot,
  "skills",
  "rundocket",
  "scripts",
  "run.mjs",
);

test("skill resolver invokes the built source-checkout CLI", () => {
  const result = spawnSync(process.execPath, [resolverPath, "--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNDOCKET_CLI: "",
      RUNDOCKET_REPO: "",
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), manifest.version);
});

test("skill resolver rejects an invalid explicit CLI without falling back", () => {
  const missingCli = join(repositoryRoot, "missing-rundocket-cli.js");
  const result = spawnSync(process.execPath, [resolverPath, "--version"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      RUNDOCKET_CLI: missingCli,
      RUNDOCKET_REPO: "",
    },
  });

  assert.equal(result.status, 127);
  assert.match(result.stderr, /RUNDOCKET_NOT_FOUND/);
  assert.match(result.stderr, /RUNDOCKET_CLI does not exist/);
});
