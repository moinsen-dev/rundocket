export const INSPECT_SCHEMA_VERSION = "rundocket.inspect.v1" as const;

export type InspectStatus =
  | "VERIFIED"
  | "FAILED"
  | "NEEDS_INPUT"
  | "UNVERIFIED";

export type ProjectKind = "expo" | "flutter" | "xcode";
export type ProjectRole = "primary" | "embedded";
export type Confidence = "high" | "medium";
export type CapabilityAvailability =
  | "available"
  | "blocked"
  | "needs_auth"
  | "needs_input"
  | "needs_server"
  | "planned"
  | "unavailable"
  | "unverified";
export type CapabilityRisk =
  | "read_only"
  | "local_mutation"
  | "external_binding"
  | "prohibited";
export type CapabilityName =
  | "inspect"
  | "doctor"
  | "plan"
  | "mcp"
  | "start"
  | "build"
  | "test"
  | "launch"
  | "logs";

export interface DetectionEvidence {
  marker: string;
  path: string;
  detail: string;
}

export interface NormalizedCapability {
  name: CapabilityName;
  availability: CapabilityAvailability;
  reason: string;
}

export interface DetectedProject {
  id: string;
  kind: ProjectKind;
  adapter: ProjectKind;
  role: ProjectRole;
  ownerProjectId: string | null;
  root: string;
  mode: string;
  confidence: Confidence;
  platforms: string[];
  capabilities: NormalizedCapability[];
  evidence: DetectionEvidence[];
}

export interface ProjectSelection {
  status: "selected" | "needs_input" | "unsupported";
  selectedProjectId: string | null;
  candidateProjectIds: string[];
}

export interface InspectDiagnostic {
  level: "warning";
  code: string;
  path: string;
  message: string;
}

export interface InspectResult {
  schemaVersion: typeof INSPECT_SCHEMA_VERSION;
  status: Exclude<InspectStatus, "FAILED">;
  generatedAt: string;
  workspace: {
    root: string;
    maxDepth: number;
    scannedDirectoryCount: number;
  };
  selection: ProjectSelection;
  projects: DetectedProject[];
  diagnostics: InspectDiagnostic[];
}

export interface InspectFailure {
  schemaVersion: "rundocket.error.v1";
  status: "FAILED";
  error: {
    code: string;
    message: string;
  };
}

export const EXIT_CODES = {
  VERIFIED: 0,
  FAILED: 1,
  NEEDS_INPUT: 20,
  UNVERIFIED: 30,
  USAGE: 64,
} as const;
