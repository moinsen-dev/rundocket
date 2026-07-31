import path from "node:path";

import { isDirectory, isFile, readTextIfFile } from "../fs-utils.js";
import type { ProjectDetector } from "./types.js";
import { bootstrapCapabilities } from "./types.js";

const APP_CONFIG_FILES = [
  "app.json",
  "app.config.json",
  "app.config.js",
  "app.config.cjs",
  "app.config.mjs",
  "app.config.ts",
];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export const detectExpo: ProjectDetector = async (directory) => {
  const packagePath = path.join(directory, "package.json");
  const packageText = await readTextIfFile(packagePath);

  if (packageText === null) {
    return null;
  }

  let packageJson: PackageJson;
  try {
    packageJson = JSON.parse(packageText) as PackageJson;
  } catch {
    return null;
  }

  const dependencyMaps = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.peerDependencies,
  ];
  const hasExpoDependency = dependencyMaps.some(
    (dependencies) => dependencies?.expo !== undefined,
  );
  const hasExpoScript = Object.values(packageJson.scripts ?? {}).some((script) =>
    /(^|\s)(npx\s+)?expo(\s|$)/.test(script),
  );

  if (!hasExpoDependency && !hasExpoScript) {
    return null;
  }

  const evidence = [
    {
      marker: "expo-package",
      absolutePath: packagePath,
      detail: hasExpoDependency
        ? "package.json declares the Expo package."
        : "package.json contains an Expo CLI script.",
    },
  ];

  let appConfigPath: string | null = null;
  for (const fileName of APP_CONFIG_FILES) {
    const candidatePath = path.join(directory, fileName);
    if (await isFile(candidatePath)) {
      appConfigPath = candidatePath;
      evidence.push({
        marker: "expo-app-config",
        absolutePath: candidatePath,
        detail: "Expo app configuration is present at the project root.",
      });
      break;
    }
  }

  const iosPath = path.join(directory, "ios");
  const androidPath = path.join(directory, "android");
  const hasIos = await isDirectory(iosPath);
  const hasAndroid = await isDirectory(androidPath);

  if (hasIos) {
    evidence.push({
      marker: "expo-native-ios",
      absolutePath: iosPath,
      detail: "A generated or maintained iOS project directory is present.",
    });
  }

  if (hasAndroid) {
    evidence.push({
      marker: "expo-native-android",
      absolutePath: androidPath,
      detail: "A generated or maintained Android project directory is present.",
    });
  }

  const dependencyNames = new Set(
    dependencyMaps.flatMap((dependencies) => Object.keys(dependencies ?? {})),
  );
  const platforms = ["ios", "android"];
  if (dependencyNames.has("react-native-web")) {
    platforms.push("web");
  }

  return {
    kind: "expo",
    absoluteRoot: directory,
    mode: hasIos || hasAndroid ? "prebuilt" : "managed",
    confidence: appConfigPath === null ? "medium" : "high",
    platforms,
    capabilities: bootstrapCapabilities(),
    evidence,
  };
};
