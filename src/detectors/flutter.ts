import path from "node:path";

import { isDirectory, isFile, readTextIfFile } from "../fs-utils.js";
import type { ProjectDetector } from "./types.js";
import { bootstrapCapabilities } from "./types.js";

const FLUTTER_PLATFORM_DIRECTORIES = [
  "android",
  "ios",
  "linux",
  "macos",
  "web",
  "windows",
];

export const detectFlutter: ProjectDetector = async (directory) => {
  const pubspecPath = path.join(directory, "pubspec.yaml");
  const pubspec = await readTextIfFile(pubspecPath);

  if (pubspec === null || !hasFlutterSdkDependency(pubspec)) {
    return null;
  }

  const evidence = [
    {
      marker: "flutter-pubspec",
      absolutePath: pubspecPath,
      detail: "pubspec.yaml declares flutter with sdk: flutter.",
    },
  ];

  const metadataPath = path.join(directory, ".metadata");
  const mainPath = path.join(directory, "lib", "main.dart");
  const hasMetadata = await isFile(metadataPath);
  const hasMain = await isFile(mainPath);

  if (hasMetadata) {
    evidence.push({
      marker: "flutter-metadata",
      absolutePath: metadataPath,
      detail: "Flutter tool metadata is present.",
    });
  }

  if (hasMain) {
    evidence.push({
      marker: "flutter-entrypoint",
      absolutePath: mainPath,
      detail: "The conventional Flutter app entry point is present.",
    });
  }

  const platforms: string[] = [];
  for (const platform of FLUTTER_PLATFORM_DIRECTORIES) {
    const platformPath = path.join(directory, platform);
    if (await isDirectory(platformPath)) {
      platforms.push(platform);
      evidence.push({
        marker: "flutter-platform",
        absolutePath: platformPath,
        detail: `Flutter platform directory detected: ${platform}.`,
      });
    }
  }

  return {
    kind: "flutter",
    absoluteRoot: directory,
    mode: hasMain ? "app" : "package",
    confidence: hasMetadata || hasMain ? "high" : "medium",
    platforms,
    capabilities: bootstrapCapabilities(),
    evidence,
  };
};

function hasFlutterSdkDependency(pubspec: string): boolean {
  const lines = pubspec.split(/\r?\n/);
  let inDependencies = false;
  let flutterIndent: number | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+#.*$/, "");
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }

    const indent = line.length - line.trimStart().length;

    if (indent === 0) {
      inDependencies = trimmed === "dependencies:";
      flutterIndent = null;
      continue;
    }

    if (!inDependencies) {
      continue;
    }

    if (/^flutter:\s*\{\s*sdk:\s*flutter\s*\}\s*$/.test(trimmed)) {
      return true;
    }

    if (trimmed === "flutter:") {
      flutterIndent = indent;
      continue;
    }

    if (
      flutterIndent !== null &&
      indent > flutterIndent &&
      /^sdk:\s*flutter\s*$/.test(trimmed)
    ) {
      return true;
    }

    if (flutterIndent !== null && indent <= flutterIndent) {
      flutterIndent = null;
    }
  }

  return false;
}
