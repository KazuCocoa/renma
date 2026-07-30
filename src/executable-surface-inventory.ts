import { createHash } from "node:crypto";
import path from "node:path";

import type { SkillParentIndex } from "./catalog.js";
import {
  classifyRepositorySkillPath,
  logicalSkillDirectory,
} from "./discovery.js";
import {
  collectHelperCommandEvidence,
  hasSupportedHelperExtension,
  resolveHelperCommandEvidence,
  type HelperCommandLauncher,
  type HelperInvocationResolution,
} from "./helper-command-evidence.js";
import type { RepositoryPathState } from "./repository-paths.js";
import type {
  SecurityPolicyAssetEvidence,
  SecurityPolicySource,
} from "./security-policy-inventory.js";
import {
  localSupportReachabilityDepth,
  staticSupportReferences,
} from "./static-support.js";
import type { Artifact, ArtifactKind } from "./types/artifact.js";
import type { ParsedDocument } from "./types/metadata.js";

export const EXECUTABLE_SURFACE_INVENTORY_SCHEMA =
  "renma.executable-surface-inventory.v1" as const;

export type ExecutableSurfaceOrigin =
  | "discovered-script"
  | "resolved-static-invocation";

export type ExecutableSurfaceScope =
  | "skill-local"
  | "repository-tool"
  | "noncanonical";

export interface ExecutableSurfaceSecurityPolicy {
  hasEffectivePolicy: boolean;
  policySources: SecurityPolicySource[];
  fingerprint?: string;
}

export type ExecutableInvocationPolicyRelation =
  | "source-artifact"
  | "owning-skill";

export interface ExecutableInvocationPolicyEvidence {
  relation: ExecutableInvocationPolicyRelation;
  path: string;
  hasEffectivePolicy: boolean;
  policySources: SecurityPolicySource[];
  fingerprint?: string;
}

export type ExecutableInvocationOwningSkillResolution =
  | "not-applicable"
  | "resolved"
  | "missing"
  | "ambiguous";

export interface ExecutableInvocationGovernance {
  owningSkillResolution: ExecutableInvocationOwningSkillResolution;
  policyEvidence: ExecutableInvocationPolicyEvidence[];
  hasEffectivePolicyEvidence: boolean;
  distinctEffectivePolicyFingerprints: string[];
  fingerprint: string;
}

export interface ExecutableSurfaceInvocationGovernanceSummary {
  invocationsWithEffectivePolicyEvidence: number;
  invocationsWithoutEffectivePolicyEvidence: number;
  distinctEffectivePolicyFingerprints: string[];
}

export interface ExecutableSurfaceEntry {
  path: string;
  scope: ExecutableSurfaceScope;
  origins: ExecutableSurfaceOrigin[];
  artifactKind: ArtifactKind;
  contentClassification: "text" | "binary";
  contentHash?: string;
  owningSkill?: {
    skillDirectory: string;
    entrypointPath?: string;
  };
  interpreterHints: string[];
  shebang?: string;
  reachableFromOwningSkill?: boolean;
  reachabilityDepth?: number;
  staticallyReferenced: boolean;
  staticallyInvoked: boolean;
  referenceCount: number;
  invocationCount: number;
  securityPolicy: ExecutableSurfaceSecurityPolicy;
  invocationGovernance: ExecutableSurfaceInvocationGovernanceSummary;
  fingerprint: string;
}

export interface ExecutableSurfaceInvocation {
  sourcePath: string;
  line: number;
  snippet: string;
  launcher: HelperCommandLauncher;
  rawTarget: string;
  normalizedTarget?: string;
  sourceSkillDirectory?: string;
  resolution: HelperInvocationResolution;
  targetPathState?: RepositoryPathState;
  occurrenceOrdinal: number;
  governance: ExecutableInvocationGovernance;
}

export interface ExecutableSurfaceInventorySummary {
  totalSurfaces: number;
  skillLocalSurfaces: number;
  repositoryToolSurfaces: number;
  noncanonicalSurfaces: number;
  textSurfaces: number;
  binarySurfaces: number;
  reachableSkillLocalSurfaces: number;
  unreachableSkillLocalSurfaces: number;
  referencedSurfaces: number;
  unreferencedSurfaces: number;
  invokedSurfaces: number;
  uninvokedSurfaces: number;
  surfacesWithEffectivePolicy: number;
  surfacesWithoutEffectivePolicy: number;
  totalInvocations: number;
  resolvedInvocations: number;
  missingInvocations: number;
  unsafeInvocations: number;
  unscopedInvocations: number;
  noncanonicalInvocations: number;
  unavailableInvocations: number;
  invocationsWithEffectivePolicyEvidence: number;
  invocationsWithoutEffectivePolicyEvidence: number;
  resolvedInvocationsWithEffectivePolicyEvidence: number;
  resolvedInvocationsWithoutEffectivePolicyEvidence: number;
  invocationsWithMultipleEffectivePolicyFingerprints: number;
  invocationPolicyEvidenceRelations: {
    sourceArtifact: number;
    owningSkill: number;
  };
  interpreterHints: Array<{
    interpreter: string;
    count: number;
  }>;
}

export interface ExecutableSurfaceInventory {
  schema: typeof EXECUTABLE_SURFACE_INVENTORY_SCHEMA;
  summary: ExecutableSurfaceInventorySummary;
  surfaces: ExecutableSurfaceEntry[];
  invocations: ExecutableSurfaceInvocation[];
}

export interface ExecutableSurfaceInventoryInput {
  artifacts: Artifact[];
  documents: ParsedDocument[];
  repositoryPaths: ReadonlySet<string>;
  repositoryPathStates: ReadonlyMap<string, RepositoryPathState>;
  skillParents: SkillParentIndex;
  securityPolicies: readonly SecurityPolicyAssetEvidence[];
}

interface StaticSurfaceReference {
  sourcePath: string;
  targetPath: string;
  line: number;
}

/** Build a non-executing inventory from evidence already collected by Renma. */
export function buildExecutableSurfaceInventory(
  input: ExecutableSurfaceInventoryInput,
): ExecutableSurfaceInventory {
  const artifactsByPath = new Map(
    input.artifacts.map((artifact) => [artifact.path, artifact]),
  );
  const invocations = inventoryInvocations(input);
  const surfaceArtifacts = new Map<string, Artifact>();

  for (const artifact of input.artifacts) {
    if (
      artifact.kind === "script" ||
      (artifact.path.startsWith("tools/") &&
        hasSupportedHelperExtension(artifact.path))
    ) {
      surfaceArtifacts.set(artifact.path, artifact);
    }
  }
  for (const invocation of invocations) {
    if (invocation.resolution !== "resolved" || !invocation.normalizedTarget) {
      continue;
    }
    const artifact = artifactsByPath.get(invocation.normalizedTarget);
    if (artifact) surfaceArtifacts.set(artifact.path, artifact);
  }

  const staticReferences = collectStaticSurfaceReferences(input);
  const policiesByPath = new Map(
    input.securityPolicies.map((policy) => [policy.path, policy]),
  );
  const reachabilityByPath = collectReachability(input);
  const surfaces = [...surfaceArtifacts.values()]
    .map((artifact) => {
      const scope = surfaceScope(artifact.path, input.skillParents);
      const matchingInvocations = invocations.filter(
        (invocation) => invocation.normalizedTarget === artifact.path,
      );
      const matchingReferences = staticReferences.filter(
        (reference) => reference.targetPath === artifact.path,
      );
      const referenceCount = combinedReferenceCount(
        matchingReferences,
        matchingInvocations,
      );
      const parent = owningSkill(artifact.path, input.skillParents);
      const policy = policiesByPath.get(artifact.path);
      const origins: ExecutableSurfaceOrigin[] = [
        ...(artifact.kind === "script" ||
        (artifact.path.startsWith("tools/") &&
          hasSupportedHelperExtension(artifact.path))
          ? (["discovered-script"] as const)
          : []),
        ...(matchingInvocations.some(
          (invocation) => invocation.resolution === "resolved",
        )
          ? (["resolved-static-invocation"] as const)
          : []),
      ];
      const shebang = artifactShebang(artifact);
      const interpreterHints = interpreterHintsFor(
        artifact.path,
        matchingInvocations.map((invocation) => invocation.launcher),
        shebang,
      );
      const reachabilityDepth =
        scope === "skill-local"
          ? reachabilityByPath.get(artifact.path)
          : undefined;
      const securityPolicy: ExecutableSurfaceSecurityPolicy = {
        hasEffectivePolicy: policy?.hasEffectivePolicy ?? false,
        policySources: [...(policy?.policySources ?? [])],
        ...(policy?.hasEffectivePolicy && policy.effectivePolicy.fingerprint
          ? { fingerprint: policy.effectivePolicy.fingerprint }
          : {}),
      };
      const invocationGovernance =
        summarizeSurfaceInvocationGovernance(matchingInvocations);
      const state = {
        path: artifact.path,
        scope,
        origins: uniqueSorted(origins),
        artifactKind: artifact.kind,
        contentClassification: artifact.contentClassification,
        ...(artifact.contentHash ? { contentHash: artifact.contentHash } : {}),
        ...(parent ? { owningSkill: parent } : {}),
        interpreterHints,
        ...(shebang ? { shebang } : {}),
        ...(scope === "skill-local"
          ? {
              reachableFromOwningSkill: reachabilityDepth !== undefined,
              ...(reachabilityDepth !== undefined ? { reachabilityDepth } : {}),
            }
          : {}),
        staticallyReferenced: referenceCount > 0,
        staticallyInvoked: matchingInvocations.length > 0,
        referenceCount,
        invocationCount: matchingInvocations.length,
        securityPolicy,
        invocationGovernance,
      };
      return {
        ...state,
        fingerprint: inventoryFingerprint(state),
      } satisfies ExecutableSurfaceEntry;
    })
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    schema: EXECUTABLE_SURFACE_INVENTORY_SCHEMA,
    summary: summarizeExecutableSurfaceInventory(surfaces, invocations),
    surfaces,
    invocations,
  };
}

export function zeroExecutableSurfaceInventory(): ExecutableSurfaceInventory {
  return {
    schema: EXECUTABLE_SURFACE_INVENTORY_SCHEMA,
    summary: summarizeExecutableSurfaceInventory([], []),
    surfaces: [],
    invocations: [],
  };
}

export function summarizeExecutableSurfaceInventory(
  surfaces: readonly ExecutableSurfaceEntry[],
  invocations: readonly ExecutableSurfaceInvocation[],
): ExecutableSurfaceInventorySummary {
  const interpreterCounts = new Map<string, number>();
  for (const surface of surfaces) {
    for (const interpreter of new Set(surface.interpreterHints)) {
      interpreterCounts.set(
        interpreter,
        (interpreterCounts.get(interpreter) ?? 0) + 1,
      );
    }
  }
  const unavailable = new Set<HelperInvocationResolution>([
    "excluded",
    "deep",
    "oversize",
    "unsupported",
    "symlink",
    "unreadable",
  ]);
  const skillLocal = surfaces.filter(
    (surface) => surface.scope === "skill-local",
  );
  return {
    totalSurfaces: surfaces.length,
    skillLocalSurfaces: skillLocal.length,
    repositoryToolSurfaces: surfaces.filter(
      (surface) => surface.scope === "repository-tool",
    ).length,
    noncanonicalSurfaces: surfaces.filter(
      (surface) => surface.scope === "noncanonical",
    ).length,
    textSurfaces: surfaces.filter(
      (surface) => surface.contentClassification === "text",
    ).length,
    binarySurfaces: surfaces.filter(
      (surface) => surface.contentClassification === "binary",
    ).length,
    reachableSkillLocalSurfaces: skillLocal.filter(
      (surface) => surface.reachableFromOwningSkill === true,
    ).length,
    unreachableSkillLocalSurfaces: skillLocal.filter(
      (surface) => surface.reachableFromOwningSkill === false,
    ).length,
    referencedSurfaces: surfaces.filter(
      (surface) => surface.staticallyReferenced,
    ).length,
    unreferencedSurfaces: surfaces.filter(
      (surface) => !surface.staticallyReferenced,
    ).length,
    invokedSurfaces: surfaces.filter((surface) => surface.staticallyInvoked)
      .length,
    uninvokedSurfaces: surfaces.filter((surface) => !surface.staticallyInvoked)
      .length,
    surfacesWithEffectivePolicy: surfaces.filter(
      (surface) => surface.securityPolicy.hasEffectivePolicy,
    ).length,
    surfacesWithoutEffectivePolicy: surfaces.filter(
      (surface) => !surface.securityPolicy.hasEffectivePolicy,
    ).length,
    totalInvocations: invocations.length,
    resolvedInvocations: resolutionCount(invocations, "resolved"),
    missingInvocations: resolutionCount(invocations, "missing"),
    unsafeInvocations: resolutionCount(invocations, "unsafe"),
    unscopedInvocations: resolutionCount(invocations, "unscoped"),
    noncanonicalInvocations: resolutionCount(invocations, "noncanonical"),
    unavailableInvocations: invocations.filter((invocation) =>
      unavailable.has(invocation.resolution),
    ).length,
    invocationsWithEffectivePolicyEvidence: invocations.filter(
      (invocation) => invocation.governance.hasEffectivePolicyEvidence,
    ).length,
    invocationsWithoutEffectivePolicyEvidence: invocations.filter(
      (invocation) => !invocation.governance.hasEffectivePolicyEvidence,
    ).length,
    resolvedInvocationsWithEffectivePolicyEvidence: invocations.filter(
      (invocation) =>
        invocation.resolution === "resolved" &&
        invocation.governance.hasEffectivePolicyEvidence,
    ).length,
    resolvedInvocationsWithoutEffectivePolicyEvidence: invocations.filter(
      (invocation) =>
        invocation.resolution === "resolved" &&
        !invocation.governance.hasEffectivePolicyEvidence,
    ).length,
    invocationsWithMultipleEffectivePolicyFingerprints: invocations.filter(
      (invocation) =>
        invocation.governance.distinctEffectivePolicyFingerprints.length > 1,
    ).length,
    invocationPolicyEvidenceRelations: {
      sourceArtifact: invocationPolicyRelationCount(
        invocations,
        "source-artifact",
      ),
      owningSkill: invocationPolicyRelationCount(invocations, "owning-skill"),
    },
    interpreterHints: [...interpreterCounts]
      .map(([interpreter, count]) => ({ interpreter, count }))
      .sort(
        (left, right) =>
          right.count - left.count ||
          left.interpreter.localeCompare(right.interpreter),
      ),
  };
}

function inventoryInvocations(
  input: ExecutableSurfaceInventoryInput,
): ExecutableSurfaceInvocation[] {
  const policiesByPath = new Map(
    input.securityPolicies.map((policy) => [policy.path, policy]),
  );
  const deduplicated = new Map<
    string,
    Omit<ExecutableSurfaceInvocation, "occurrenceOrdinal">
  >();
  for (const evidence of collectHelperCommandEvidence(input.documents)) {
    const resolved = resolveHelperCommandEvidence(
      evidence,
      input.repositoryPathStates,
    );
    const resolution =
      resolved.resolution === "resolved" &&
      resolved.normalizedTarget &&
      surfaceScope(resolved.normalizedTarget, input.skillParents) ===
        "noncanonical"
        ? "noncanonical"
        : resolved.resolution;
    const governance = invocationGovernance(
      resolved.sourcePath,
      input.skillParents,
      policiesByPath,
    );
    const invocation = {
      sourcePath: resolved.sourcePath,
      line: resolved.line,
      snippet: boundedSnippet(resolved.snippet),
      launcher: resolved.launcher,
      rawTarget: resolved.rawTarget,
      ...(resolved.normalizedTarget
        ? { normalizedTarget: resolved.normalizedTarget }
        : {}),
      ...(resolved.sourceSkillDirectory
        ? { sourceSkillDirectory: resolved.sourceSkillDirectory }
        : {}),
      resolution,
      ...(resolved.targetPathState
        ? { targetPathState: resolved.targetPathState }
        : {}),
      governance,
    };
    deduplicated.set(JSON.stringify(invocation), invocation);
  }

  const ordinalBySemanticEvidence = new Map<string, number>();
  return [...deduplicated.values()]
    .sort(compareInvocations)
    .map((invocation) => {
      const key = semanticInvocationBaseKey(invocation);
      const occurrenceOrdinal = (ordinalBySemanticEvidence.get(key) ?? 0) + 1;
      ordinalBySemanticEvidence.set(key, occurrenceOrdinal);
      return { ...invocation, occurrenceOrdinal };
    });
}

function invocationGovernance(
  sourcePath: string,
  skillParents: SkillParentIndex,
  policiesByPath: ReadonlyMap<string, SecurityPolicyAssetEvidence>,
): ExecutableInvocationGovernance {
  const skillDirectory = logicalSkillDirectory(sourcePath);
  const parents = skillDirectory
    ? (skillParents.get(skillDirectory) ?? [])
    : [];
  const owningSkillResolution: ExecutableInvocationOwningSkillResolution =
    skillDirectory === undefined
      ? "not-applicable"
      : parents.length === 0
        ? "missing"
        : parents.length === 1
          ? "resolved"
          : "ambiguous";
  const policyEvidence: ExecutableInvocationPolicyEvidence[] = [];
  const sourcePolicy = policiesByPath.get(sourcePath);
  if (sourcePolicy) {
    policyEvidence.push(
      invocationPolicyEvidence("source-artifact", sourcePolicy),
    );
  }
  const ownerPath =
    owningSkillResolution === "resolved" ? parents[0]!.sourcePath : undefined;
  if (ownerPath && ownerPath !== sourcePath) {
    const owningSkillPolicy = policiesByPath.get(ownerPath);
    if (owningSkillPolicy) {
      policyEvidence.push(
        invocationPolicyEvidence("owning-skill", owningSkillPolicy),
      );
    }
  }
  policyEvidence.sort(compareInvocationPolicyEvidence);
  const distinctEffectivePolicyFingerprints = uniqueSorted(
    policyEvidence.flatMap((evidence) =>
      evidence.hasEffectivePolicy && evidence.fingerprint
        ? [evidence.fingerprint]
        : [],
    ),
  );
  const fingerprintState = {
    owningSkillResolution,
    policyEvidence,
  };
  return {
    owningSkillResolution,
    policyEvidence,
    hasEffectivePolicyEvidence: policyEvidence.some(
      (evidence) => evidence.hasEffectivePolicy,
    ),
    distinctEffectivePolicyFingerprints,
    fingerprint: inventoryFingerprint(fingerprintState),
  };
}

function invocationPolicyEvidence(
  relation: ExecutableInvocationPolicyRelation,
  policy: SecurityPolicyAssetEvidence,
): ExecutableInvocationPolicyEvidence {
  return {
    relation,
    path: policy.path,
    hasEffectivePolicy: policy.hasEffectivePolicy,
    policySources: sortedPolicySources(policy.policySources),
    ...(policy.hasEffectivePolicy && policy.effectivePolicy.fingerprint
      ? { fingerprint: policy.effectivePolicy.fingerprint }
      : {}),
  };
}

function compareInvocationPolicyEvidence(
  left: ExecutableInvocationPolicyEvidence,
  right: ExecutableInvocationPolicyEvidence,
): number {
  return (
    invocationPolicyRelationOrder(left.relation) -
      invocationPolicyRelationOrder(right.relation) ||
    left.path.localeCompare(right.path) ||
    (left.fingerprint ?? "").localeCompare(right.fingerprint ?? "")
  );
}

function invocationPolicyRelationOrder(
  relation: ExecutableInvocationPolicyRelation,
): number {
  return relation === "source-artifact" ? 0 : 1;
}

function sortedPolicySources(
  sources: readonly SecurityPolicySource[],
): SecurityPolicySource[] {
  const order: SecurityPolicySource[] = [
    "local",
    "security_profile",
    "repository_config",
    "owning_skill",
  ];
  return [...new Set(sources)].sort(
    (left, right) => order.indexOf(left) - order.indexOf(right),
  );
}

function summarizeSurfaceInvocationGovernance(
  invocations: readonly ExecutableSurfaceInvocation[],
): ExecutableSurfaceInvocationGovernanceSummary {
  return {
    invocationsWithEffectivePolicyEvidence: invocations.filter(
      (invocation) => invocation.governance.hasEffectivePolicyEvidence,
    ).length,
    invocationsWithoutEffectivePolicyEvidence: invocations.filter(
      (invocation) => !invocation.governance.hasEffectivePolicyEvidence,
    ).length,
    distinctEffectivePolicyFingerprints: uniqueSorted(
      invocations.flatMap(
        (invocation) =>
          invocation.governance.distinctEffectivePolicyFingerprints,
      ),
    ),
  };
}

function invocationPolicyRelationCount(
  invocations: readonly ExecutableSurfaceInvocation[],
  relation: ExecutableInvocationPolicyRelation,
): number {
  return invocations.reduce(
    (count, invocation) =>
      count +
      invocation.governance.policyEvidence.filter(
        (evidence) => evidence.relation === relation,
      ).length,
    0,
  );
}

function collectStaticSurfaceReferences(
  input: ExecutableSurfaceInventoryInput,
): StaticSurfaceReference[] {
  const references = new Map<string, StaticSurfaceReference>();
  const skillDirectories = new Set(
    input.documents
      .map((document) => logicalSkillDirectory(document.artifact.path))
      .filter((value): value is string => value !== undefined),
  );
  for (const skillDirectory of [...skillDirectories].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const sources = input.documents.filter(
      (document) =>
        logicalSkillDirectory(document.artifact.path) === skillDirectory,
    );
    const candidatePaths = [...input.repositoryPaths].filter((candidate) => {
      const classified = classifyRepositorySkillPath(candidate);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    for (const source of sources) {
      for (const reference of staticSupportReferences(
        source,
        skillDirectory,
        candidatePaths,
      )) {
        const row = {
          sourcePath: source.artifact.path,
          targetPath: reference.targetPath,
          line: reference.line,
        };
        references.set(
          `${row.sourcePath}\0${row.line}\0${row.targetPath}`,
          row,
        );
      }
    }
  }
  const repositoryToolPaths = input.artifacts
    .map((artifact) => artifact.path)
    .filter(
      (artifactPath) =>
        artifactPath.startsWith("tools/") &&
        hasSupportedHelperExtension(artifactPath),
    );
  for (const document of input.documents.filter(
    (candidate) => candidate.artifact.markdownParserEligible,
  )) {
    for (let index = 0; index < document.lines.length; index += 1) {
      const line = document.lines[index] ?? "";
      for (const toolPath of repositoryToolPaths) {
        if (!containsExactRepositoryPath(line, toolPath)) continue;
        const row = {
          sourcePath: document.artifact.path,
          targetPath: toolPath,
          line: index + 1,
        };
        references.set(
          `${row.sourcePath}\0${row.line}\0${row.targetPath}`,
          row,
        );
      }
    }
  }
  return [...references.values()].sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.line - right.line ||
      left.targetPath.localeCompare(right.targetPath),
  );
}

function containsExactRepositoryPath(line: string, repositoryPath: string) {
  const escaped = repositoryPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^A-Za-z0-9_.-])${escaped}(?=$|[^A-Za-z0-9_./-])`,
  ).test(line);
}

function collectReachability(
  input: ExecutableSurfaceInventoryInput,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  const documentsByPath = new Map(
    input.documents.map((document) => [document.artifact.path, document]),
  );
  for (const [skillDirectory, parents] of input.skillParents) {
    if (parents.length !== 1) continue;
    const skill = documentsByPath.get(parents[0]!.sourcePath);
    if (!skill) continue;
    const localSupportDocs = input.documents.filter((document) => {
      const classified = classifyRepositorySkillPath(document.artifact.path);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    const candidatePaths = [...input.repositoryPaths].filter((candidate) => {
      const classified = classifyRepositorySkillPath(candidate);
      return (
        classified?.kind === "support" &&
        classified.skillDirectory === skillDirectory
      );
    });
    for (const [surfacePath, depth] of localSupportReachabilityDepth(
      skill,
      skillDirectory,
      localSupportDocs,
      candidatePaths,
    )) {
      result.set(surfacePath, depth);
    }
  }
  return result;
}

function surfaceScope(
  surfacePath: string,
  skillParents: SkillParentIndex,
): ExecutableSurfaceScope {
  if (surfacePath.startsWith("tools/")) return "repository-tool";
  const classified = classifyRepositorySkillPath(surfacePath);
  if (
    classified?.kind === "support" &&
    classified.supportDirectory === "scripts" &&
    skillParents.get(classified.skillDirectory)?.length === 1
  ) {
    return "skill-local";
  }
  return "noncanonical";
}

function owningSkill(
  surfacePath: string,
  skillParents: SkillParentIndex,
): ExecutableSurfaceEntry["owningSkill"] {
  const classified = classifyRepositorySkillPath(surfacePath);
  if (
    classified?.kind !== "support" ||
    classified.supportDirectory !== "scripts"
  ) {
    return undefined;
  }
  const parents = skillParents.get(classified.skillDirectory) ?? [];
  if (parents.length !== 1) return undefined;
  return {
    skillDirectory: classified.skillDirectory,
    entrypointPath: parents[0]!.sourcePath,
  };
}

function artifactShebang(artifact: Artifact): string | undefined {
  if (artifact.contentClassification !== "text") return undefined;
  const firstLine = artifact.content.split(/\r?\n/, 1)[0]?.trimEnd();
  if (!firstLine?.startsWith("#!")) return undefined;
  return firstLine.slice(0, 160);
}

function interpreterHintsFor(
  surfacePath: string,
  launchers: readonly HelperCommandLauncher[],
  shebang: string | undefined,
): string[] {
  const hints = new Set<string>(launchers);
  if (shebang) hints.add(shebangInterpreter(shebang));
  if (hints.size === 0) hints.add(extensionInterpreter(surfacePath));
  return [...hints].sort((left, right) => left.localeCompare(right));
}

function shebangInterpreter(shebang: string): string {
  const words = shebang
    .slice(2)
    .trim()
    .split(/\s+/)
    .map((word) => path.posix.basename(word));
  const recognized = words.find((word) =>
    ["node", "bash", "sh", "python", "python3"].includes(word),
  );
  return recognized ?? "unknown";
}

function extensionInterpreter(surfacePath: string): string {
  switch (path.posix.extname(surfacePath).toLowerCase()) {
    case ".mjs":
    case ".js":
    case ".cjs":
      return "node";
    case ".bash":
      return "bash";
    case ".sh":
      return "sh";
    case ".py":
      return "python";
    default:
      return "unknown";
  }
}

function combinedReferenceCount(
  references: readonly StaticSurfaceReference[],
  invocations: readonly ExecutableSurfaceInvocation[],
): number {
  const evidence = new Set(
    references.map(
      (reference) =>
        `${reference.sourcePath}\0${reference.line}\0${reference.targetPath}`,
    ),
  );
  for (const invocation of invocations) {
    evidence.add(
      `${invocation.sourcePath}\0${invocation.line}\0${invocation.normalizedTarget ?? invocation.rawTarget}`,
    );
  }
  return evidence.size;
}

function compareInvocations(
  left: Omit<ExecutableSurfaceInvocation, "occurrenceOrdinal">,
  right: Omit<ExecutableSurfaceInvocation, "occurrenceOrdinal">,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.line - right.line ||
    left.launcher.localeCompare(right.launcher) ||
    (left.normalizedTarget ?? left.rawTarget).localeCompare(
      right.normalizedTarget ?? right.rawTarget,
    ) ||
    left.rawTarget.localeCompare(right.rawTarget) ||
    left.resolution.localeCompare(right.resolution)
  );
}

function semanticInvocationBaseKey(
  invocation: Omit<ExecutableSurfaceInvocation, "occurrenceOrdinal">,
): string {
  return [
    invocation.sourcePath,
    invocation.launcher,
    invocation.normalizedTarget ?? invocation.rawTarget,
    invocation.resolution,
  ].join("\0");
}

function boundedSnippet(snippet: string): string {
  const normalized = snippet.replace(/\s+/g, " ").trim();
  return normalized.length <= 240 ? normalized : `${normalized.slice(0, 239)}…`;
}

function inventoryFingerprint(value: object): string {
  return `sha256:${createHash("sha256")
    .update(stableJson(value))
    .digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function resolutionCount(
  invocations: readonly ExecutableSurfaceInvocation[],
  resolution: HelperInvocationResolution,
): number {
  return invocations.filter(
    (invocation) => invocation.resolution === resolution,
  ).length;
}
