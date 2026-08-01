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

test("the CLI reports a bundled skill that ships with the same version", () => {
  const cliPath = join(repositoryRoot, "dist", "src", "cli.js");
  const result = spawnSync(process.execPath, [cliPath, "skill", "path"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  const skillRoot = result.stdout.trim();
  assert.equal(skillRoot, join(repositoryRoot, "skills", "rundocket"));

  const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
  assert.match(skill, /^name: rundocket$/m);

  // The bundled skill must travel inside the published tarball, otherwise the
  // path is only meaningful in a source checkout.
  const files = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  ) as { files: string[] };
  assert.ok(files.files.includes("skills/"));
  assert.ok(manifest.version.length > 0);
});
