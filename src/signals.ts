import type { OperationName } from "./plan.js";
import type { ProjectKind } from "./model.js";

export const SIGNALS_SCHEMA_VERSION = "rundocket.signals.v1" as const;

/**
 * Ordered lifecycle of a long-running development command.
 *
 * A framework command frequently completes its useful work long before its
 * process exits: a development server keeps serving, and `expo run:ios` keeps
 * a bundler in the foreground after the app is already installed. Milestones
 * make that distinction observable instead of leaving an agent to guess from
 * raw output.
 */
export const MILESTONE_ORDER = [
  "starting",
  "resolving",
  "compiling",
  "built",
  "installed",
  "serving",
] as const;

export type MilestoneName = (typeof MILESTONE_ORDER)[number];

export type DiagnosticSeverity = "error" | "warning";

export interface DiagnosticRecord {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  fatal: boolean;
  at: string;
}

export interface MilestoneRecord {
  name: MilestoneName;
  at: string;
  evidence: string;
}

interface MilestoneRule {
  name: MilestoneName;
  pattern: RegExp;
}

interface DiagnosticRule {
  code: string;
  severity: DiagnosticSeverity;
  /** A fatal diagnostic ends a wait even while the process keeps running. */
  fatal: boolean;
  pattern: RegExp;
}

export interface SignalDefinition {
  /** Milestone that marks the requested work as done. */
  completion: MilestoneName;
  /** Whether the command is expected to exit on its own once it is done. */
  completesOnExit: boolean;
  milestones: MilestoneRule[];
  diagnostics: DiagnosticRule[];
}

/** The plan-visible projection of a signal definition. */
export interface SignalContract {
  schemaVersion: typeof SIGNALS_SCHEMA_VERSION;
  completion: MilestoneName;
  completesOnExit: boolean;
  expectedMilestones: MilestoneName[];
}

const COMMON_DIAGNOSTICS: DiagnosticRule[] = [
  {
    code: "COMMAND_ERROR",
    severity: "error",
    fatal: true,
    pattern: /^\s*(?:›\s*)?CommandError:/,
  },
  {
    code: "PORT_IN_USE",
    severity: "error",
    fatal: true,
    pattern: /EADDRINUSE|address already in use/i,
  },
  {
    code: "COMPILER_ERROR",
    severity: "error",
    fatal: false,
    pattern: /^.*?:\d+:\d+:\s*error:/,
  },
];

const EXPO_START: SignalDefinition = {
  completion: "serving",
  completesOnExit: false,
  milestones: [
    {
      name: "serving",
      pattern:
        /Waiting on (?:http|exp):\/\/|Metro waiting on|Bundler ready|Logs for your project will appear below/i,
    },
  ],
  diagnostics: COMMON_DIAGNOSTICS,
};

/**
 * `expo run:<platform>` builds, installs, launches, and then stays in the
 * foreground — with or without `--no-bundler`. Its process does not exit on
 * success, which is exactly the case that makes agents wait indefinitely on an
 * already-finished build.
 *
 * The observed order on iOS is `Build Succeeded` -> `Waiting on http://…` ->
 * `› Installing …`, so the bundler line is deliberately not a milestone here:
 * it appears before the install and would mask the completion signal.
 */
const EXPO_RUN: SignalDefinition = {
  completion: "installed",
  completesOnExit: false,
  milestones: [
    {
      name: "resolving",
      pattern:
        /^\s*›\s*(?:Preparing|Installing CocoaPods|Running pod install)|Resolving dependencies|Updating dependencies/i,
    },
    { name: "compiling", pattern: /^\s*›\s*(?:Compiling|Executing|Packaging|Linking)\s/ },
    { name: "built", pattern: /^\s*›\s*Build Succeeded|\*\* BUILD SUCCEEDED \*\*/ },
    {
      name: "installed",
      pattern:
        /^\s*[-›]\s*(?:Installing(?! CocoaPods)|Connecting to:|Opening on|Successfully installed)/,
    },
  ],
  diagnostics: [
    ...COMMON_DIAGNOSTICS,
    {
      code: "XCODEBUILD_FAILED",
      severity: "error",
      fatal: true,
      pattern: /\*\* BUILD FAILED \*\*|xcodebuild exited with non-zero code|The following build commands failed/,
    },
    {
      code: "GRADLE_FAILED",
      severity: "error",
      fatal: true,
      pattern: /FAILURE: Build failed with an exception|Execution failed for task/,
    },
    {
      code: "POD_INSTALL_FAILED",
      severity: "error",
      fatal: true,
      pattern: /Unicode Normalization not appropriate for ASCII-8BIT|\[!\] .*(?:CocoaPods|pod install)/,
    },
    {
      code: "DEVICE_UNAVAILABLE",
      severity: "error",
      fatal: true,
      pattern: /Unable to (?:boot|find) device|No devices? (?:are )?(?:available|connected)/i,
    },
    {
      code: "SIGNING_REQUIRED",
      severity: "error",
      fatal: true,
      pattern: /requires a development team|Signing for .* requires/,
    },
  ],
};

const EXPO_TEST: SignalDefinition = {
  completion: "built",
  completesOnExit: true,
  milestones: [
    { name: "built", pattern: /Tests:\s+\d|Test Suites:\s+\d/ },
  ],
  diagnostics: [
    ...COMMON_DIAGNOSTICS,
    {
      code: "TESTS_FAILED",
      severity: "error",
      fatal: false,
      pattern: /^\s*FAIL\s|Tests:.*\d+ failed/,
    },
  ],
};

const FLUTTER_RUN: SignalDefinition = {
  completion: "serving",
  completesOnExit: false,
  milestones: [
    { name: "compiling", pattern: /Running Xcode build|Running Gradle task|Building /i },
    { name: "built", pattern: /Xcode build done|Built build\/|✓\s+Built / },
    { name: "installed", pattern: /Installing and launching|Syncing files to device/ },
    {
      name: "serving",
      pattern: /Flutter run key commands|Dart VM Service.*is available|hot reload/i,
    },
  ],
  diagnostics: [
    ...COMMON_DIAGNOSTICS,
    {
      code: "FLUTTER_FAILED",
      severity: "error",
      fatal: true,
      pattern: /^Error: |FAILURE: Build failed|Error launching application|Exception: /m,
    },
  ],
};

const FLUTTER_BUILD: SignalDefinition = {
  completion: "built",
  completesOnExit: true,
  milestones: [
    { name: "compiling", pattern: /Running Xcode build|Running Gradle task|Building /i },
    { name: "built", pattern: /✓\s+Built |Built build\// },
  ],
  diagnostics: FLUTTER_RUN.diagnostics,
};

const FLUTTER_TEST: SignalDefinition = {
  completion: "built",
  completesOnExit: true,
  milestones: [
    { name: "built", pattern: /All tests passed|Some tests failed|\+\d+(?::\s|\s-\d+)/ },
  ],
  diagnostics: [
    ...COMMON_DIAGNOSTICS,
    {
      code: "TESTS_FAILED",
      severity: "error",
      fatal: false,
      pattern: /Some tests failed|^\s*\d+ tests? failed/m,
    },
  ],
};

const XCODEBUILD: SignalDefinition = {
  completion: "built",
  completesOnExit: true,
  milestones: [
    { name: "compiling", pattern: /^(?:Compile|Ld|CompileSwiftSources|ProcessInfoPlistFile)\s/m },
    { name: "built", pattern: /\*\* (?:BUILD|TEST) SUCCEEDED \*\*/ },
  ],
  diagnostics: [
    ...COMMON_DIAGNOSTICS,
    {
      code: "XCODEBUILD_FAILED",
      severity: "error",
      fatal: true,
      pattern: /\*\* (?:BUILD|TEST) FAILED \*\*|The following build commands failed/,
    },
    {
      code: "SIGNING_REQUIRED",
      severity: "error",
      fatal: true,
      pattern: /requires a development team|Signing for .* requires/,
    },
  ],
};

export interface SignalSelector {
  kind: ProjectKind;
  operation: OperationName;
}

export function signalsFor(
  selector: SignalSelector,
): SignalDefinition | null {
  const { kind, operation } = selector;
  if (kind === "expo") {
    switch (operation) {
      case "start":
        return EXPO_START;
      case "build":
      case "launch":
        return EXPO_RUN;
      case "test":
        return EXPO_TEST;
      case "logs":
        return null;
    }
  }
  if (kind === "flutter") {
    switch (operation) {
      case "start":
      case "launch":
        return FLUTTER_RUN;
      case "build":
        return FLUTTER_BUILD;
      case "test":
        return FLUTTER_TEST;
      case "logs":
        return null;
    }
  }
  if (kind === "xcode") {
    switch (operation) {
      case "build":
      case "test":
        return XCODEBUILD;
      case "start":
      case "launch":
      case "logs":
        return null;
    }
  }
  return null;
}

export function signalContract(
  definition: SignalDefinition,
): SignalContract {
  // Every managed run records `starting` when its process is spawned.
  const expected = new Set<MilestoneName>(["starting"]);
  for (const rule of definition.milestones) {
    expected.add(rule.name);
  }
  return {
    schemaVersion: SIGNALS_SCHEMA_VERSION,
    completion: definition.completion,
    completesOnExit: definition.completesOnExit,
    expectedMilestones: MILESTONE_ORDER.filter((name) =>
      expected.has(name),
    ),
  };
}

export function milestoneRank(name: MilestoneName): number {
  return MILESTONE_ORDER.indexOf(name);
}

export interface LineClassification {
  milestone: MilestoneName | null;
  diagnostic: Omit<DiagnosticRecord, "at"> | null;
}

export function classifyLine(
  definition: SignalDefinition,
  line: string,
): LineClassification {
  const trimmed = line.trimEnd();
  if (trimmed === "") {
    return { milestone: null, diagnostic: null };
  }

  let milestone: MilestoneName | null = null;
  for (const rule of definition.milestones) {
    if (rule.pattern.test(trimmed)) {
      if (milestone === null || milestoneRank(rule.name) > milestoneRank(milestone)) {
        milestone = rule.name;
      }
    }
  }

  let diagnostic: Omit<DiagnosticRecord, "at"> | null = null;
  for (const rule of definition.diagnostics) {
    if (rule.pattern.test(trimmed)) {
      diagnostic = {
        severity: rule.severity,
        code: rule.code,
        message: trimmed.slice(0, 500),
        fatal: rule.fatal,
      };
      break;
    }
  }

  return { milestone, diagnostic };
}
