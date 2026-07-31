import type { InspectResult } from "./model.js";

export function formatInspectResult(result: InspectResult): string {
  const lines = [
    "RunDocket inspect",
    `Status: ${result.status}`,
    `Workspace: ${result.workspace.root}`,
    `Selection: ${result.selection.status}`,
  ];

  if (result.selection.selectedProjectId !== null) {
    lines.push(`Selected: ${result.selection.selectedProjectId}`);
  }

  if (result.projects.length === 0) {
    lines.push("Projects: none");
  } else {
    lines.push("Projects:");
    for (const project of result.projects) {
      const owner =
        project.ownerProjectId === null
          ? ""
          : `, owner ${project.ownerProjectId}`;
      lines.push(
        `  - ${project.id} (${project.role}${owner}, ${project.mode}, ${project.confidence} confidence)`,
      );
      lines.push(
        `    platforms: ${project.platforms.join(", ") || "unknown"}`,
      );
      lines.push(
        `    capabilities: ${project.capabilities
          .map(
            (capability) =>
              `${capability.name}:${capability.availability}`,
          )
          .join(", ")}`,
      );
      lines.push(
        `    evidence: ${project.evidence.map((item) => item.path).join(", ")}`,
      );
    }
  }

  if (result.selection.status === "needs_input") {
    lines.push(
      `Candidates: ${result.selection.candidateProjectIds.join(", ")}`,
    );
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(
      `Warning [${diagnostic.code}] ${diagnostic.path}: ${diagnostic.message}`,
    );
  }

  return lines.join("\n");
}
