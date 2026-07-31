import path from "node:path";

import type {
  DetectedProject,
  InspectResult,
  InspectStatus,
} from "./model.js";

export interface SelectedProject {
  status: Exclude<InspectStatus, "FAILED">;
  project: DetectedProject | null;
  absoluteRoot: string | null;
  reason: string;
}

export function selectPrimaryProject(
  inspection: InspectResult,
  projectId?: string,
): SelectedProject {
  if (projectId !== undefined) {
    const project = inspection.projects.find(
      (candidate) =>
        candidate.id === projectId && candidate.role === "primary",
    );

    if (project === undefined) {
      return {
        status: "NEEDS_INPUT",
        project: null,
        absoluteRoot: null,
        reason: `Unknown or non-primary project ID: ${projectId}`,
      };
    }

    return {
      status: "VERIFIED",
      project,
      absoluteRoot: path.resolve(inspection.workspace.root, project.root),
      reason: "The caller selected an explicit primary project.",
    };
  }

  const selectedId = inspection.selection.selectedProjectId;
  if (selectedId === null) {
    return {
      status: inspection.status,
      project: null,
      absoluteRoot: null,
      reason:
        inspection.selection.status === "needs_input"
          ? "Multiple primary projects require an explicit project ID."
          : "No supported primary project is available.",
    };
  }

  const project =
    inspection.projects.find((candidate) => candidate.id === selectedId) ??
    null;
  if (project === null) {
    return {
      status: "UNVERIFIED",
      project: null,
      absoluteRoot: null,
      reason: "The selected project was missing from the inspection result.",
    };
  }

  return {
    status: "VERIFIED",
    project,
    absoluteRoot: path.resolve(inspection.workspace.root, project.root),
    reason: "The workspace contains exactly one primary project.",
  };
}
