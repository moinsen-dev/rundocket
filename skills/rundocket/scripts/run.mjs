#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const attempts = [];

function run(command, commandArgs, label, allowMissing = false) {
  attempts.push(label);
  const result = spawnSync(command, commandArgs, {
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    if (allowMissing && result.error.code === "ENOENT") {
      return false;
    }
    console.error(`RUNDOCKET_EXEC_FAILED: ${label}: ${result.error.message}`);
    process.exit(126);
  }

  if (result.signal) {
    console.error(`RUNDOCKET_EXEC_FAILED: ${label}: terminated by ${result.signal}`);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

function runScript(scriptPath, label) {
  if (!existsSync(scriptPath)) {
    attempts.push(`${label} (missing: ${scriptPath})`);
    return false;
  }
  return run(process.execPath, [scriptPath, ...args], label);
}

function findProjectBin(startDirectory) {
  let directory = resolve(startDirectory);
  while (true) {
    const names = process.platform === "win32"
      ? ["rundocket.cmd", "rundocket.exe", "rundocket"]
      : ["rundocket"];
    for (const name of names) {
      const candidate = join(directory, "node_modules", ".bin", name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function sourceCheckoutCli(scriptDirectory) {
  const repository = resolve(scriptDirectory, "..", "..", "..");
  const packagePath = join(repository, "package.json");
  if (!existsSync(packagePath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
    if (manifest.name !== "rundocket") return null;
  } catch {
    return null;
  }
  return join(repository, "dist", "src", "cli.js");
}

const explicitCli = process.env.RUNDOCKET_CLI;
if (explicitCli) {
  const candidate = isAbsolute(explicitCli) ? explicitCli : resolve(explicitCli);
  if (!existsSync(candidate)) {
    console.error(`RUNDOCKET_NOT_FOUND: RUNDOCKET_CLI does not exist: ${candidate}`);
    process.exit(127);
  }
  if (/\.(?:c|m)?js$/i.test(candidate)) {
    run(process.execPath, [candidate, ...args], "RUNDOCKET_CLI JavaScript entrypoint");
  }
  run(candidate, args, "RUNDOCKET_CLI executable");
}

const explicitRepo = process.env.RUNDOCKET_REPO;
if (explicitRepo) {
  const candidate = join(resolve(explicitRepo), "dist", "src", "cli.js");
  if (!runScript(candidate, "RUNDOCKET_REPO build")) {
    console.error("Build the configured checkout with `npm install && npm run build`.");
    process.exit(127);
  }
}

const projectBin = findProjectBin(process.cwd());
if (projectBin) {
  run(projectBin, args, "project-local rundocket executable");
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const checkoutCli = sourceCheckoutCli(scriptDirectory);
if (checkoutCli && runScript(checkoutCli, "RunDocket source checkout build")) {
  process.exit(0);
}

if (run("rundocket", args, "rundocket on PATH", true) === false) {
  console.error("RUNDOCKET_NOT_FOUND: no runnable RunDocket CLI was found.");
  console.error("Checked:");
  for (const attempt of attempts) console.error(`- ${attempt}`);
  console.error("Set RUNDOCKET_CLI or RUNDOCKET_REPO, install RunDocket locally, or add it to PATH.");
  process.exit(127);
}
