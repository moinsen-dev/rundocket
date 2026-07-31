import path from "node:path";

import { detectExpo } from "./detectors/expo.js";
import { detectFlutter } from "./detectors/flutter.js";
import type {
  ProjectCandidate,
  ProjectDetector,
} from "./detectors/types.js";
import { detectXcode } from "./detectors/xcode.js";
import {
  isWithinOrSame,
  relativePath,
  resolveWorkspaceRoot,
  walkDirectories,
} from "./fs-utils.js";
import {
  INSPECT_SCHEMA_VERSION,
  type DetectedProject,
  type InspectResult,
} from "./model.js";

const DETECTORS: ProjectDetector[] = [detectExpo, detectFlutter, detectXcode];
const OWNER_KINDS = new Set(["expo", "flutter"]);

export interface InspectOptions {
  maxDepth?: number;
}

export async function inspectWorkspace(
  inputPath: string,
  options: InspectOptions = {},
): Promise<InspectResult> {
  const maxDepth = options.maxDepth ?? 4;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 12) {
    throw new Error("maxDepth must be an integer between 0 and 12.");
  }

  const workspaceRoot = await resolveWorkspaceRoot(inputPath);
  const walk = await walkDirectories(workspaceRoot, maxDepth);
  const candidates: ProjectCandidate[] = [];

  for (const directory of walk.directories) {
    const detected = await Promise.all(
      DETECTORS.map((detector) => detector(directory)),
    );

    for (const candidate of detected) {
      if (candidate !== null) {
        candidates.push(candidate);
      }
    }
  }

  const uniqueCandidates = deduplicateCandidates(candidates).sort(
    (left, right) => {
      const rootComparison = left.absoluteRoot.localeCompare(right.absoluteRoot);
      return rootComparison !== 0
        ? rootComparison
        : left.kind.localeCompare(right.kind);
    },
  );

  const projectIds = new Map<ProjectCandidate, string>();
  for (const candidate of uniqueCandidates) {
    projectIds.set(
      candidate,
      `${candidate.kind}:${relativePath(workspaceRoot, candidate.absoluteRoot)}`,
    );
  }

  const projects: DetectedProject[] = uniqueCandidates.map((candidate) => {
    const owner = findOwner(candidate, uniqueCandidates);
    const id = projectIds.get(candidate);
    if (id === undefined) {
      throw new Error("Internal error: project ID was not assigned.");
    }

    return {
      id,
      kind: candidate.kind,
      adapter: candidate.kind,
      role: owner === null ? "primary" : "embedded",
      ownerProjectId: owner === null ? null : (projectIds.get(owner) ?? null),
      root: relativePath(workspaceRoot, candidate.absoluteRoot),
      mode: candidate.mode,
      confidence: candidate.confidence,
      platforms: candidate.platforms,
      capabilities: candidate.capabilities,
      evidence: candidate.evidence.map((item) => ({
        marker: item.marker,
        path: relativePath(workspaceRoot, item.absolutePath),
        detail: item.detail,
      })),
    };
  });

  const primaryProjects = projects.filter(
    (project) => project.role === "primary",
  );
  const candidateProjectIds = primaryProjects.map((project) => project.id);

  if (primaryProjects.length === 1) {
    return {
      schemaVersion: INSPECT_SCHEMA_VERSION,
      status: "VERIFIED",
      generatedAt: new Date().toISOString(),
      workspace: {
        root: workspaceRoot,
        maxDepth,
        scannedDirectoryCount: walk.directories.length,
      },
      selection: {
        status: "selected",
        selectedProjectId: primaryProjects[0]?.id ?? null,
        candidateProjectIds,
      },
      projects,
      diagnostics: walk.diagnostics,
    };
  }

  if (primaryProjects.length > 1) {
    return {
      schemaVersion: INSPECT_SCHEMA_VERSION,
      status: "NEEDS_INPUT",
      generatedAt: new Date().toISOString(),
      workspace: {
        root: workspaceRoot,
        maxDepth,
        scannedDirectoryCount: walk.directories.length,
      },
      selection: {
        status: "needs_input",
        selectedProjectId: null,
        candidateProjectIds,
      },
      projects,
      diagnostics: walk.diagnostics,
    };
  }

  return {
    schemaVersion: INSPECT_SCHEMA_VERSION,
    status: "UNVERIFIED",
    generatedAt: new Date().toISOString(),
    workspace: {
      root: workspaceRoot,
      maxDepth,
      scannedDirectoryCount: walk.directories.length,
    },
    selection: {
      status: "unsupported",
      selectedProjectId: null,
      candidateProjectIds: [],
    },
    projects,
    diagnostics: walk.diagnostics,
  };
}

function deduplicateCandidates(
  candidates: ProjectCandidate[],
): ProjectCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}\0${candidate.absoluteRoot}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function findOwner(
  candidate: ProjectCandidate,
  candidates: ProjectCandidate[],
): ProjectCandidate | null {
  if (candidate.kind !== "xcode") {
    return null;
  }

  const owners = candidates
    .filter((possibleOwner) => OWNER_KINDS.has(possibleOwner.kind))
    .filter((possibleOwner) =>
      isWithinOrSame(possibleOwner.absoluteRoot, candidate.absoluteRoot),
    )
    .sort(
      (left, right) =>
        right.absoluteRoot.length - left.absoluteRoot.length,
    );

  return owners[0] ?? null;
}
