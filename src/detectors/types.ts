import type {
  Confidence,
  NormalizedCapability,
  ProjectKind,
} from "../model.js";

export interface CandidateEvidence {
  marker: string;
  absolutePath: string;
  detail: string;
}

export interface ProjectCandidate {
  kind: ProjectKind;
  absoluteRoot: string;
  mode: string;
  confidence: Confidence;
  platforms: string[];
  capabilities: NormalizedCapability[];
  evidence: CandidateEvidence[];
}

export type ProjectDetector = (
  directory: string,
) => Promise<ProjectCandidate | null>;

export function bootstrapCapabilities(): NormalizedCapability[] {
  return [
    {
      name: "inspect",
      availability: "available",
      reason: "Implemented by the read-only bootstrap.",
    },
    {
      name: "doctor",
      availability: "available",
      reason: "Implemented by the read-only readiness kernel.",
    },
    {
      name: "plan",
      availability: "available",
      reason: "Implemented by the immutable operation planner.",
    },
    {
      name: "mcp",
      availability: "available",
      reason: "Implemented by the headless stdio MCP server.",
    },
    {
      name: "start",
      availability: "planned",
      reason: "Available only after adapter-specific lifecycle verification.",
    },
    {
      name: "build",
      availability: "planned",
      reason: "Planned adapter workflow; not implemented yet.",
    },
    {
      name: "test",
      availability: "planned",
      reason: "Planned adapter workflow; not implemented yet.",
    },
    {
      name: "launch",
      availability: "planned",
      reason: "Planned adapter workflow; not implemented yet.",
    },
    {
      name: "logs",
      availability: "planned",
      reason: "Planned adapter workflow; not implemented yet.",
    },
  ];
}
