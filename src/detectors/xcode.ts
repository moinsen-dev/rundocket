import { readdir } from "node:fs/promises";
import path from "node:path";

import { readTextIfFile } from "../fs-utils.js";
import type { ProjectDetector } from "./types.js";
import { bootstrapCapabilities } from "./types.js";

const SDK_PLATFORM_MARKERS: Array<[RegExp, string]> = [
  [/\bSDKROOT\s*=\s*iphoneos\b/, "ios"],
  [/\bSDKROOT\s*=\s*macosx\b/, "macos"],
  [/\bSDKROOT\s*=\s*appletvos\b/, "tvos"],
  [/\bSDKROOT\s*=\s*watchos\b/, "watchos"],
  [/\bSDKROOT\s*=\s*xros\b/, "visionos"],
];

export const detectXcode: ProjectDetector = async (directory) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return null;
  }

  const projectNames = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"))
    .map((entry) => entry.name)
    .sort();
  const workspaceNames = entries
    .filter(
      (entry) => entry.isDirectory() && entry.name.endsWith(".xcworkspace"),
    )
    .map((entry) => entry.name)
    .sort();

  if (projectNames.length === 0 && workspaceNames.length === 0) {
    return null;
  }

  const evidence = [
    ...projectNames.map((name) => ({
      marker: "xcode-project",
      absolutePath: path.join(directory, name),
      detail: "An Xcode project bundle is present.",
    })),
    ...workspaceNames.map((name) => ({
      marker: "xcode-workspace",
      absolutePath: path.join(directory, name),
      detail: "An Xcode workspace bundle is present.",
    })),
  ];

  const platforms = new Set<string>();
  for (const projectName of projectNames) {
    const projectFile = path.join(directory, projectName, "project.pbxproj");
    const projectText = await readTextIfFile(projectFile);
    if (projectText === null) {
      continue;
    }

    for (const [pattern, platform] of SDK_PLATFORM_MARKERS) {
      if (pattern.test(projectText)) {
        platforms.add(platform);
      }
    }
  }

  if (platforms.size === 0) {
    platforms.add("apple");
  }

  return {
    kind: "xcode",
    absoluteRoot: directory,
    mode: workspaceNames.length > 0 ? "workspace" : "project",
    confidence: "high",
    platforms: [...platforms].sort(),
    capabilities: bootstrapCapabilities(),
    evidence,
  };
};
