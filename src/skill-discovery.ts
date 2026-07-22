import path from "node:path";

import {
  validateAgentSkills,
  type AgentSkillValidationResult,
  type AgentSkillsValidationSummary,
} from "./agent-skills.js";
import {
  AGENT_SKILL_DIAGNOSTIC_IDS,
  DIAGNOSTIC_IDS,
} from "./diagnostic-ids.js";
import {
  parseCanonicalSkillContinuationField,
  parseCanonicalSkillPublicationField,
  type CanonicalSkillContinuationItem,
  type CanonicalSkillPublicationField,
  type CanonicalSkillPublicationFieldState,
} from "./metadata.js";
import type { Asset, AssetKind, AssetStatus, Catalog } from "./model.js";
import type { AssetOwnership } from "./types/governance.js";
import type { Diagnostic, Evidence } from "./types/diagnostics.js";
import type {
  MetadataFieldEvidence,
  ParsedDocument,
} from "./types/metadata.js";

export const SKILL_ROUTE_USABILITY_REASONS = [
  "invalid-source",
  "invalid-target",
  "inactive-source",
  "inactive-target",
  "duplicate-source-id",
  "duplicate-target-id",
  "wrong-kind",
  "ambiguous-target",
  "unresolved-target",
  "duplicate-declaration",
] as const;

export type SkillRouteUsabilityReason =
  (typeof SKILL_ROUTE_USABILITY_REASONS)[number];

export type SkillRouteResolutionState =
  | "resolved"
  | "unresolved"
  | "ambiguous"
  | "wrong-kind";

export type SkillRouteNormalizationRejection =
  | "absolute-path"
  | "repository-escape";

export interface SkillDiagnosticLink {
  code: string;
  evidence?: Evidence;
}

export const SKILL_PUBLICATION_REJECTION_REASONS = [
  "invalid-marker",
  "ambiguous-marker",
  "invalid-skill",
  "inactive-skill",
  "duplicate-skill-id",
] as const;

export type SkillPublicationRejectionReason =
  (typeof SKILL_PUBLICATION_REJECTION_REASONS)[number];

const PUBLISHED_ENTRYPOINT_BOUNDARIES = [
  {
    code: AGENT_SKILL_DIAGNOSTIC_IDS.RN_DESCRIPTION_MISSING_CAPABILITY,
    label: "capability",
  },
  {
    code: AGENT_SKILL_DIAGNOSTIC_IDS.RN_DESCRIPTION_MISSING_USAGE_BOUNDARY,
    label: "positive usage boundary",
  },
  {
    code: AGENT_SKILL_DIAGNOSTIC_IDS.RN_DESCRIPTION_OMITS_SELECTION_BOUNDARY,
    label: "negative selection/routing boundary",
  },
] as const;

export interface SkillPublicationMarker {
  state: CanonicalSkillPublicationFieldState;
  canonicalKey: "metadata.renma.published-entrypoint";
  present: boolean;
  valid: boolean;
  rawValue?: unknown;
  evidence?: Evidence;
  reason?: string;
}

export interface SkillPublicationState {
  marker: SkillPublicationMarker;
  requested: boolean;
  accepted: boolean;
  rejectionReasons: SkillPublicationRejectionReason[];
  linkedDiagnostics: SkillDiagnosticLink[];
}

export type SkillDiscoveryReachabilityState =
  | "reachable"
  | "not-reached"
  | "not-evaluated";

export type SkillDiscoveryReachabilityReason =
  | "published-entrypoint"
  | "reachable-through-usable-route"
  | "no-usable-path-from-published-entrypoint"
  | "skill-not-discovery-eligible"
  | "coverage-not-evaluated";

export interface SkillDiscoveryReachability {
  state: SkillDiscoveryReachabilityState;
  reason: SkillDiscoveryReachabilityReason;
  sourceEntrypointIds: string[];
  minimumDepth?: number;
}

export interface VisibleSkillIdentity {
  /** Path-based identity remains authoritative even when the visible ID is duplicated. */
  identity: string;
  id: string;
  sourcePath: string;
  name?: string;
  description?: string;
  lifecycle?: AssetStatus;
  ownership: AssetOwnership;
  agentSkillsValid: boolean;
  lifecycleActive: boolean;
  effectiveIdUnique: boolean;
  routeEligible: boolean;
  routeEligibilityReasons: SkillRouteUsabilityReason[];
  publication: SkillPublicationState;
  structuralRoot: boolean;
  standalone: boolean;
  unrouted: boolean;
  reachability: SkillDiscoveryReachability;
  linkedDiagnostics: SkillDiagnosticLink[];
}

export interface SkillRouteCandidateIdentity {
  id: string;
  sourcePath: string;
  kind: AssetKind;
  lifecycle?: AssetStatus;
  matchedBy: Array<"id" | "path">;
}

export interface ResolvedSkillRouteTarget {
  id: string;
  sourcePath: string;
  kind: AssetKind;
  lifecycle?: AssetStatus;
  effectiveIdUnique: boolean;
  agentSkillsValid?: boolean;
}

export interface SkillRouteDeclarationEvidence extends Evidence {
  metadataKey: "metadata.renma.continues-with";
  declarationIndex: number;
}

export interface DeclaredSkillRoute {
  sourceId: string;
  sourcePath: string;
  declarationIndex: number;
  rawTarget: string;
  normalizedTarget: string;
  normalizationRejection?: SkillRouteNormalizationRejection;
  resolution: SkillRouteResolutionState;
  candidates: SkillRouteCandidateIdentity[];
  resolvedTarget?: ResolvedSkillRouteTarget;
  usable: boolean;
  usabilityReasons: SkillRouteUsabilityReason[];
  representative: boolean;
  duplicateDeclarationIndices: number[];
  evidence: SkillRouteDeclarationEvidence;
  linkedDiagnostics: SkillDiagnosticLink[];
}

export interface SkillDiscoveryRouteCycleSkill {
  id: string;
  sourcePath: string;
}

export interface SkillDiscoveryRouteCycleRoute {
  sourceId: string;
  sourcePath: string;
  targetId: string;
  targetPath: string;
  declarationIndex: number;
  evidence: SkillRouteDeclarationEvidence;
}

/** One maximal cyclic component in the authoritative usable continuation graph. */
export interface SkillDiscoveryRouteCycle {
  cycleSkillIds: string[];
  cycleSkills: SkillDiscoveryRouteCycleSkill[];
  selfLoop: boolean;
  cycleRoutes: SkillDiscoveryRouteCycleRoute[];
}

export interface SkillDiscoverySummary {
  visibleSkillCount: number;
  routeEligibleSkillCount: number;
  declaredRouteCount: number;
  usableRouteCount: number;
  unresolvedRouteCount: number;
  ambiguousRouteCount: number;
  unresolvedOrAmbiguousRouteCount: number;
  invalidRouteCount: number;
  structuralRootCount: number;
  standaloneSkillCount: number;
  unroutedSkillCount: number;
  publishedEntrypointCount: number;
  reachableSkillCount: number;
  notReachedSkillCount: number;
}

export type SkillDiscoveryAdoptionState =
  | "not-adopted"
  | "partial"
  | "incomplete"
  | "adopted";

export interface SkillDiscoveryAdoption {
  state: SkillDiscoveryAdoptionState;
  discoveryMetadataPresent: boolean;
  repositoryWideAdopted: boolean;
  publishedEntrypointCount: number;
  reason:
    | "no-discovery-metadata-or-repository-adoption"
    | "discovery-metadata-present-without-repository-adoption"
    | "repository-adoption-has-no-effective-published-entrypoint"
    | "repository-adoption-has-effective-published-entrypoint";
  configPath?: string;
}

interface SkillDiscoveryCoverageBase {
  scope: "repository";
  sourceEntrypointIds: string[];
  eligibleSkillCount: number;
  reachableSkillCount: number;
  notReachedSkillCount: number;
}

export type SkillDiscoveryCoverage =
  | (SkillDiscoveryCoverageBase & {
      mode: "not-evaluated";
      reason: "discovery-not-adopted" | "no-effective-published-entrypoint";
      complete: null;
    })
  | (SkillDiscoveryCoverageBase & {
      mode: "descriptive";
      reason: "partial-adoption-with-effective-published-entrypoint";
      complete: null;
    })
  | (SkillDiscoveryCoverageBase & {
      mode: "authoritative";
      reason: "repository-wide-discovery-adopted";
      complete: boolean;
    });

export interface SkillDiscoveryReachabilityResolution {
  coverage: SkillDiscoveryCoverage;
  reachabilityBySkillId: ReadonlyMap<string, SkillDiscoveryReachability>;
  reachableDiscoveryEligibleSkillIds: string[];
  notReachedDiscoveryEligibleSkillIds: string[];
}

/** Warning diagnostic emitted from explicit Skill continuation evidence. */
export type SkillDiscoveryDiagnostic = Diagnostic;

export interface SkillDiscoveryIndex {
  skills: VisibleSkillIdentity[];
  routes: DeclaredSkillRoute[];
  adoption: SkillDiscoveryAdoption;
  coverage: SkillDiscoveryCoverage;
  publishedEntrypointIds: string[];
  reachableDiscoveryEligibleSkillIds: string[];
  notReachedDiscoveryEligibleSkillIds: string[];
  structuralRootIds: string[];
  standaloneSkillIds: string[];
  unroutedSkillIds: string[];
  summary: SkillDiscoverySummary;
  diagnostics: SkillDiscoveryDiagnostic[];
  focus?: {
    id: string;
    sourcePath: string;
  };
}

export interface SkillDiscoveryPreparationOptions {
  repositoryWideAdopted?: boolean;
  configPath?: string;
}

type MutableRoute = DeclaredSkillRoute;

interface NormalizedTarget {
  value: string;
  rejection?: SkillRouteNormalizationRejection;
}

/** Build one deterministic static Skill continuation index from prepared repository data. */
export function prepareSkillDiscoveryIndex(
  documents: ParsedDocument[],
  catalog: Catalog,
  agentSkills: AgentSkillsValidationSummary = validateAgentSkills(documents),
  options: SkillDiscoveryPreparationOptions = {},
): SkillDiscoveryIndex {
  const validationsByPath = new Map(
    agentSkills.results.map((result) => [result.path, result]),
  );
  const idCounts = countAssetIds(catalog.assets);
  const documentsByPath = new Map(
    documents.map((document) => [document.artifact.path, document]),
  );
  const continuationFieldsByPath = new Map(
    documents.map((document) => [
      document.artifact.path,
      parseCanonicalSkillContinuationField(document),
    ]),
  );
  const publicationFieldsByPath = new Map(
    documents.map((document) => [
      document.artifact.path,
      parseCanonicalSkillPublicationField(document),
    ]),
  );
  const skills = catalog.assets
    .filter((asset) => asset.kind === "skill")
    .map((asset) =>
      visibleSkill(
        asset,
        validationsByPath.get(asset.sourcePath),
        idCounts.get(asset.id) === 1,
        publicationFieldsByPath.get(asset.sourcePath),
      ),
    )
    .sort(compareVisibleSkills);
  const skillsByPath = new Map(
    skills.map((skill) => [skill.sourcePath, skill]),
  );
  const diagnostics: Diagnostic[] = [];
  const routes: MutableRoute[] = [];

  for (const skill of skills) {
    const document = documentsByPath.get(skill.sourcePath);
    if (!document) continue;
    const declaration = continuationFieldsByPath.get(skill.sourcePath)!;
    if (declaration.state === "invalid") {
      diagnostics.push(
        invalidDeclarationDiagnostic(
          skill,
          declaration.canonicalKey,
          declaration.reason ?? "the declaration is invalid",
          declaration.fieldEvidence,
        ),
      );
      continue;
    }
    if (declaration.state !== "valid") continue;

    for (const item of declaration.items) {
      routes.push(
        resolveDeclaredRoute(
          skill,
          item,
          catalog.assets,
          skillsByPath,
          idCounts,
        ),
      );
    }
  }

  routes.sort(compareRoutes);
  diagnostics.push(...markDuplicateDeclarations(routes));
  for (const route of routes) {
    diagnostics.push(...routeDiagnostics(route, skillsByPath));
  }
  diagnostics.push(
    ...resolveSkillDiscoveryRouteCycles(routes).map(routeCycleDiagnostic),
  );
  diagnostics.sort(compareDiagnostics);
  linkDiscoveryDiagnostics(routes, diagnostics);
  linkRouteCycleSkillDiagnostics(skills, diagnostics);

  for (const skill of skills) {
    const publicationDiagnostic = publicationDiagnosticFor(skill);
    if (publicationDiagnostic) diagnostics.push(publicationDiagnostic);
    const boundaryDiagnostic = publishedEntrypointBoundaryDiagnostic(skill);
    if (boundaryDiagnostic) diagnostics.push(boundaryDiagnostic);
  }
  diagnostics.sort(compareDiagnostics);
  linkPublicationDiagnostics(skills, diagnostics);

  const usableRoutes = routes.filter((route) => route.usable);
  const incoming = new Set(
    usableRoutes.flatMap((route) =>
      route.resolvedTarget?.kind === "skill" ? [route.resolvedTarget.id] : [],
    ),
  );
  const outgoing = new Set(usableRoutes.map((route) => route.sourceId));
  const eligibleSkills = skills.filter((skill) => skill.routeEligible);
  const structuralRootIds = eligibleSkills
    .filter((skill) => !incoming.has(skill.id))
    .map((skill) => skill.id)
    .sort((left, right) => left.localeCompare(right));
  const standaloneSkillIds = eligibleSkills
    .filter((skill) => !incoming.has(skill.id) && !outgoing.has(skill.id))
    .map((skill) => skill.id)
    .sort((left, right) => left.localeCompare(right));
  const structuralRoots = new Set(structuralRootIds);
  const standaloneSkills = new Set(standaloneSkillIds);
  for (const skill of skills) {
    skill.structuralRoot = structuralRoots.has(skill.id);
    skill.standalone = standaloneSkills.has(skill.id);
  }
  const publishedEntrypointIds = skills
    .filter((skill) => skill.publication.accepted)
    .sort(compareVisibleSkills)
    .map((skill) => skill.id);
  const discoveryMetadataPresent = [
    ...continuationFieldsByPath.values(),
    ...publicationFieldsByPath.values(),
  ].some((field) => field.state !== "absent" && field.state !== "unsupported");
  const adoption = skillDiscoveryAdoption(
    discoveryMetadataPresent,
    options.repositoryWideAdopted === true,
    publishedEntrypointIds.length,
    options.configPath,
  );
  const reachability = resolveSkillDiscoveryReachability(
    skills,
    routes,
    publishedEntrypointIds,
    adoption,
  );
  const publishedEntrypoints = new Set(publishedEntrypointIds);
  const unroutedSkillIds = structuralRootIds.filter(
    (id) => !publishedEntrypoints.has(id),
  );
  const unroutedSkills = new Set(unroutedSkillIds);
  for (const skill of skills) {
    skill.unrouted = unroutedSkills.has(skill.id);
    skill.reachability =
      reachability.reachabilityBySkillId.get(skill.id) ??
      notEvaluatedReachability("skill-not-discovery-eligible");
  }

  if (reachability.coverage.mode === "authoritative") {
    const assetsByPath = new Map(
      catalog.assets.map((asset) => [asset.sourcePath, asset]),
    );
    for (const id of reachability.notReachedDiscoveryEligibleSkillIds) {
      const skill = skills.find(
        (candidate) => candidate.routeEligible && candidate.id === id,
      );
      if (!skill) continue;
      diagnostics.push(
        unreachableEligibleSkillDiagnostic(
          skill,
          assetsByPath.get(skill.sourcePath),
          reachability.coverage,
          adoption,
        ),
      );
    }
    diagnostics.sort(compareDiagnostics);
    linkUnreachableDiagnostics(skills, diagnostics);
  }

  const publicRoutes: DeclaredSkillRoute[] = routes;
  return {
    skills,
    routes: publicRoutes,
    adoption,
    coverage: reachability.coverage,
    publishedEntrypointIds,
    reachableDiscoveryEligibleSkillIds:
      reachability.reachableDiscoveryEligibleSkillIds,
    notReachedDiscoveryEligibleSkillIds:
      reachability.notReachedDiscoveryEligibleSkillIds,
    structuralRootIds,
    standaloneSkillIds,
    unroutedSkillIds,
    summary: summarizeDiscovery(
      skills,
      publicRoutes,
      publishedEntrypointIds,
      structuralRootIds,
      standaloneSkillIds,
      unroutedSkillIds,
      reachability.reachableDiscoveryEligibleSkillIds,
      reachability.notReachedDiscoveryEligibleSkillIds,
    ),
    diagnostics,
  };
}

/** Resolve an exact Skill focus and retain only its direct declared neighborhood. */
export function focusSkillDiscoveryIndex(
  index: SkillDiscoveryIndex,
  focus: string,
  commandName: "graph" | "skill-index" = "graph",
): SkillDiscoveryIndex {
  const normalized = normalizeSkillRouteTarget(focus);
  const idMatches = index.skills.filter(
    (skill) => skill.id === normalized.value,
  );
  const pathMatches = index.skills.filter(
    (skill) => normalizeSourcePath(skill.sourcePath) === normalized.value,
  );
  const matches = uniqueSkillsByPath([...idMatches, ...pathMatches]);
  if (matches.length === 0) {
    throw new Error(
      `${commandName} --focus did not match any Skill id or source path: ${focus}`,
    );
  }
  if (idMatches.length > 1 || matches.length > 1) {
    throw new Error(
      `${commandName} --focus is ambiguous; use one exact repository-relative SKILL.md path: ${focus}`,
    );
  }

  const selected = matches[0]!;
  const routes = index.routes.filter(
    (route) =>
      route.sourcePath === selected.sourcePath ||
      route.resolvedTarget?.sourcePath === selected.sourcePath ||
      route.candidates.some(
        (candidate) => candidate.sourcePath === selected.sourcePath,
      ),
  );
  const visiblePaths = new Set<string>([selected.sourcePath]);
  for (const route of routes) {
    visiblePaths.add(route.sourcePath);
    if (route.resolvedTarget?.kind === "skill") {
      visiblePaths.add(route.resolvedTarget.sourcePath);
    }
  }
  const skills = index.skills.filter((skill) =>
    visiblePaths.has(skill.sourcePath),
  );
  const structuralRootIds = index.structuralRootIds.filter((id) =>
    skills.some((skill) => skill.id === id),
  );
  const standaloneSkillIds = index.standaloneSkillIds.filter((id) =>
    skills.some((skill) => skill.id === id),
  );
  const publishedEntrypointIds = index.publishedEntrypointIds.filter((id) =>
    skills.some((skill) => skill.id === id),
  );
  const reachableDiscoveryEligibleSkillIds =
    index.reachableDiscoveryEligibleSkillIds.filter((id) =>
      skills.some((skill) => skill.id === id),
    );
  const notReachedDiscoveryEligibleSkillIds =
    index.notReachedDiscoveryEligibleSkillIds.filter((id) =>
      skills.some((skill) => skill.id === id),
    );
  const unroutedSkillIds = index.unroutedSkillIds.filter((id) =>
    skills.some((skill) => skill.id === id),
  );
  const routeKeys = new Set(
    routes.map(
      (route) => `${route.sourcePath}\0${route.declarationIndex.toString()}`,
    ),
  );
  const diagnostics = index.diagnostics.filter((diagnostic) => {
    if (!diagnostic.path) return false;
    const diagnosticRouteKeys = routeKeysForDiagnostic(diagnostic);
    if (diagnosticRouteKeys.length > 0) {
      return diagnosticRouteKeys.some((key) => routeKeys.has(key));
    }
    return visiblePaths.has(diagnostic.path);
  });

  return {
    skills,
    routes,
    adoption: index.adoption,
    coverage: index.coverage,
    publishedEntrypointIds,
    reachableDiscoveryEligibleSkillIds,
    notReachedDiscoveryEligibleSkillIds,
    structuralRootIds,
    standaloneSkillIds,
    unroutedSkillIds,
    summary: summarizeDiscovery(
      skills,
      routes,
      publishedEntrypointIds,
      structuralRootIds,
      standaloneSkillIds,
      unroutedSkillIds,
      reachableDiscoveryEligibleSkillIds,
      notReachedDiscoveryEligibleSkillIds,
    ),
    diagnostics,
    focus: { id: selected.id, sourcePath: selected.sourcePath },
  };
}

/**
 * Resolve deterministic, cycle-safe Skill reachability from prepared Discovery
 * evidence. This function is pure and never re-evaluates route validity.
 */
export function resolveSkillDiscoveryReachability(
  skills: readonly VisibleSkillIdentity[],
  routes: readonly DeclaredSkillRoute[],
  publishedEntrypointIds: readonly string[],
  adoption: SkillDiscoveryAdoption,
): SkillDiscoveryReachabilityResolution {
  const eligibleSkillIds = skills
    .filter((skill) => skill.routeEligible)
    .map((skill) => skill.id)
    .sort((left, right) => left.localeCompare(right));
  const sourceEntrypointIds = [...new Set(publishedEntrypointIds)].sort(
    (left, right) => left.localeCompare(right),
  );
  const mode =
    adoption.state === "adopted"
      ? "authoritative"
      : adoption.state === "partial" && sourceEntrypointIds.length > 0
        ? "descriptive"
        : "not-evaluated";
  const reachabilityBySkillId = new Map<string, SkillDiscoveryReachability>();

  for (const skill of skills) {
    if (!skill.routeEligible) {
      reachabilityBySkillId.set(
        skill.id,
        notEvaluatedReachability("skill-not-discovery-eligible"),
      );
    }
  }

  if (mode === "not-evaluated") {
    for (const id of eligibleSkillIds) {
      reachabilityBySkillId.set(
        id,
        notEvaluatedReachability("coverage-not-evaluated"),
      );
    }
    return {
      coverage: {
        scope: "repository",
        mode,
        reason:
          adoption.state === "not-adopted"
            ? "discovery-not-adopted"
            : "no-effective-published-entrypoint",
        sourceEntrypointIds: [],
        eligibleSkillCount: eligibleSkillIds.length,
        reachableSkillCount: 0,
        notReachedSkillCount: 0,
        complete: null,
      },
      reachabilityBySkillId,
      reachableDiscoveryEligibleSkillIds: [],
      notReachedDiscoveryEligibleSkillIds: [],
    };
  }

  const adjacency = usableSkillAdjacency(routes);
  const sourcesBySkillId = new Map<string, Set<string>>();
  const minimumDepthBySkillId = new Map<string, number>();
  for (const entrypointId of sourceEntrypointIds) {
    const depths = minimumDepthsFromEntrypoint(entrypointId, adjacency);
    for (const [skillId, depth] of depths) {
      const sources = sourcesBySkillId.get(skillId) ?? new Set<string>();
      sources.add(entrypointId);
      sourcesBySkillId.set(skillId, sources);
      minimumDepthBySkillId.set(
        skillId,
        Math.min(minimumDepthBySkillId.get(skillId) ?? depth, depth),
      );
    }
  }

  const reachableDiscoveryEligibleSkillIds = eligibleSkillIds.filter((id) =>
    sourcesBySkillId.has(id),
  );
  const notReachedDiscoveryEligibleSkillIds = eligibleSkillIds.filter(
    (id) => !sourcesBySkillId.has(id),
  );
  const entrypointSet = new Set(sourceEntrypointIds);
  for (const id of reachableDiscoveryEligibleSkillIds) {
    reachabilityBySkillId.set(id, {
      state: "reachable",
      reason: entrypointSet.has(id)
        ? "published-entrypoint"
        : "reachable-through-usable-route",
      sourceEntrypointIds: [...(sourcesBySkillId.get(id) ?? [])].sort((a, b) =>
        a.localeCompare(b),
      ),
      minimumDepth: minimumDepthBySkillId.get(id)!,
    });
  }
  for (const id of notReachedDiscoveryEligibleSkillIds) {
    reachabilityBySkillId.set(id, {
      state: "not-reached",
      reason: "no-usable-path-from-published-entrypoint",
      sourceEntrypointIds: [],
    });
  }

  const commonCoverage = {
    scope: "repository" as const,
    sourceEntrypointIds,
    eligibleSkillCount: eligibleSkillIds.length,
    reachableSkillCount: reachableDiscoveryEligibleSkillIds.length,
    notReachedSkillCount: notReachedDiscoveryEligibleSkillIds.length,
  };
  const coverage: SkillDiscoveryCoverage =
    mode === "authoritative"
      ? {
          ...commonCoverage,
          mode,
          reason: "repository-wide-discovery-adopted",
          complete: notReachedDiscoveryEligibleSkillIds.length === 0,
        }
      : {
          ...commonCoverage,
          mode,
          reason: "partial-adoption-with-effective-published-entrypoint",
          complete: null,
        };

  return {
    coverage,
    reachabilityBySkillId,
    reachableDiscoveryEligibleSkillIds,
    notReachedDiscoveryEligibleSkillIds,
  };
}

/**
 * Resolve maximal cyclic components from the already authoritative usable
 * Skill continuation graph. This pure helper does not reinterpret usability,
 * reachability, or repository evidence.
 */
export function resolveSkillDiscoveryRouteCycles(
  routes: readonly DeclaredSkillRoute[],
): SkillDiscoveryRouteCycle[] {
  const eligibleRoutes = routes
    .filter(isAuthoritativeUsableSkillRoute)
    .sort(compareCycleRoutes);
  const nodeIds = [
    ...new Set(
      eligibleRoutes.flatMap((route) => [
        route.sourceId,
        route.resolvedTarget!.id,
      ]),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const targetSetsBySource = new Map<string, Set<string>>(
    nodeIds.map((id) => [id, new Set<string>()]),
  );
  const sourceSetsByTarget = new Map<string, Set<string>>(
    nodeIds.map((id) => [id, new Set<string>()]),
  );
  for (const route of eligibleRoutes) {
    const targetId = route.resolvedTarget!.id;
    targetSetsBySource.get(route.sourceId)!.add(targetId);
    sourceSetsByTarget.get(targetId)!.add(route.sourceId);
  }
  const targetsBySource = new Map<string, string[]>(
    nodeIds.map((id) => [
      id,
      [...targetSetsBySource.get(id)!].sort((left, right) =>
        left.localeCompare(right),
      ),
    ]),
  );
  const sourcesByTarget = new Map<string, string[]>(
    nodeIds.map((id) => [
      id,
      [...sourceSetsByTarget.get(id)!].sort((left, right) =>
        left.localeCompare(right),
      ),
    ]),
  );

  const visited = new Set<string>();
  const finishingOrder: string[] = [];
  for (const nodeId of nodeIds) {
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);
    const traversal: Array<{ nodeId: string; nextTargetIndex: number }> = [
      { nodeId, nextTargetIndex: 0 },
    ];
    while (traversal.length > 0) {
      const frame = traversal[traversal.length - 1]!;
      const targets = targetsBySource.get(frame.nodeId)!;
      const targetId = targets[frame.nextTargetIndex];
      if (targetId !== undefined) {
        frame.nextTargetIndex += 1;
        if (!visited.has(targetId)) {
          visited.add(targetId);
          traversal.push({ nodeId: targetId, nextTargetIndex: 0 });
        }
        continue;
      }
      finishingOrder.push(frame.nodeId);
      traversal.pop();
    }
  }

  const assigned = new Set<string>();
  const components: string[][] = [];
  for (let index = finishingOrder.length - 1; index >= 0; index -= 1) {
    const nodeId = finishingOrder[index]!;
    if (assigned.has(nodeId)) continue;
    assigned.add(nodeId);
    const component: string[] = [];
    const traversal = [nodeId];
    while (traversal.length > 0) {
      const member = traversal.pop()!;
      component.push(member);
      const sources = sourcesByTarget.get(member)!;
      for (
        let sourceIndex = sources.length - 1;
        sourceIndex >= 0;
        sourceIndex -= 1
      ) {
        const sourceId = sources[sourceIndex]!;
        if (assigned.has(sourceId)) continue;
        assigned.add(sourceId);
        traversal.push(sourceId);
      }
    }
    components.push(component.sort((left, right) => left.localeCompare(right)));
  }

  const componentBySkillId = new Map<string, number>();
  for (const [componentId, component] of components.entries()) {
    for (const skillId of component) {
      componentBySkillId.set(skillId, componentId);
    }
  }
  const internalRoutesByComponent = new Map<
    number,
    Array<DeclaredSkillRoute & { resolvedTarget: ResolvedSkillRouteTarget }>
  >();
  for (const route of eligibleRoutes) {
    const sourceComponent = componentBySkillId.get(route.sourceId)!;
    const targetComponent = componentBySkillId.get(route.resolvedTarget!.id)!;
    if (sourceComponent !== targetComponent) continue;
    const internalRoutes = internalRoutesByComponent.get(sourceComponent) ?? [];
    internalRoutes.push(route);
    internalRoutesByComponent.set(sourceComponent, internalRoutes);
  }

  return components
    .flatMap((cycleSkillIds, componentId): SkillDiscoveryRouteCycle[] => {
      const internalRoutes = internalRoutesByComponent.get(componentId) ?? [];
      const selfLoop =
        cycleSkillIds.length === 1 &&
        internalRoutes.some(
          (route) => route.resolvedTarget!.id === route.sourceId,
        );
      if (cycleSkillIds.length === 1 && !selfLoop) return [];

      const pathsById = new Map<string, Set<string>>();
      for (const route of internalRoutes) {
        const sourcePaths = pathsById.get(route.sourceId) ?? new Set<string>();
        sourcePaths.add(route.sourcePath);
        pathsById.set(route.sourceId, sourcePaths);
        const targetPaths =
          pathsById.get(route.resolvedTarget!.id) ?? new Set<string>();
        targetPaths.add(route.resolvedTarget!.sourcePath);
        pathsById.set(route.resolvedTarget!.id, targetPaths);
      }
      return [
        {
          cycleSkillIds,
          cycleSkills: cycleSkillIds.map((id) => ({
            id,
            sourcePath: [...(pathsById.get(id) ?? [])].sort((left, right) =>
              left.localeCompare(right),
            )[0]!,
          })),
          selfLoop,
          cycleRoutes: internalRoutes.map(projectCycleRoute),
        },
      ];
    })
    .sort(compareRouteCycles);
}

/** Apply the reviewed target spelling normalization without fuzzy matching. */
export function normalizeSkillRouteTarget(target: string): NormalizedTarget {
  let value = target.trim().replaceAll("\\", "/");
  if (value.startsWith("./")) value = value.slice(2);
  if (
    path.posix.isAbsolute(value) ||
    /^[A-Za-z]:\//.test(value) ||
    value.startsWith("//")
  ) {
    return { value, rejection: "absolute-path" };
  }

  let depth = 0;
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (depth === 0) {
        return { value, rejection: "repository-escape" };
      }
      depth -= 1;
      continue;
    }
    depth += 1;
  }
  return { value };
}

function visibleSkill(
  asset: Asset,
  validation: AgentSkillValidationResult | undefined,
  effectiveIdUnique: boolean,
  marker: CanonicalSkillPublicationField | undefined,
): VisibleSkillIdentity {
  const lifecycleActive =
    asset.metadata.status !== "deprecated" &&
    asset.metadata.status !== "archived";
  const routeEligibilityReasons: SkillRouteUsabilityReason[] = [];
  if (validation?.valid !== true)
    routeEligibilityReasons.push("invalid-source");
  if (!lifecycleActive) routeEligibilityReasons.push("inactive-source");
  if (!effectiveIdUnique) routeEligibilityReasons.push("duplicate-source-id");
  const publicationMarker = publicationMarkerProjection(marker);
  const publicationRejectionReasons = publicationRejectionReasonsFor(
    publicationMarker.state,
    validation?.valid === true,
    lifecycleActive,
    effectiveIdUnique,
  );
  const linkedDiagnostics = skillDiagnosticLinks(
    asset,
    validation,
    effectiveIdUnique,
  );
  return {
    identity: asset.sourcePath,
    id: asset.id,
    sourcePath: asset.sourcePath,
    ...(validation?.name ? { name: validation.name } : {}),
    ...(validation?.description ? { description: validation.description } : {}),
    ...(asset.metadata.status ? { lifecycle: asset.metadata.status } : {}),
    ownership: asset.ownership,
    agentSkillsValid: validation?.valid === true,
    lifecycleActive,
    effectiveIdUnique,
    routeEligible: routeEligibilityReasons.length === 0,
    routeEligibilityReasons,
    publication: {
      marker: publicationMarker,
      requested: publicationMarker.state === "valid",
      accepted:
        publicationMarker.state === "valid" &&
        publicationRejectionReasons.length === 0,
      rejectionReasons: publicationRejectionReasons,
      linkedDiagnostics: [...linkedDiagnostics],
    },
    structuralRoot: false,
    standalone: false,
    unrouted: false,
    reachability: notEvaluatedReachability(
      routeEligibilityReasons.length === 0
        ? "coverage-not-evaluated"
        : "skill-not-discovery-eligible",
    ),
    linkedDiagnostics,
  };
}

function notEvaluatedReachability(
  reason: Extract<
    SkillDiscoveryReachabilityReason,
    "skill-not-discovery-eligible" | "coverage-not-evaluated"
  >,
): SkillDiscoveryReachability {
  return {
    state: "not-evaluated",
    reason,
    sourceEntrypointIds: [],
  };
}

function usableSkillAdjacency(
  routes: readonly DeclaredSkillRoute[],
): ReadonlyMap<string, readonly string[]> {
  const targetsBySource = new Map<string, Set<string>>();
  for (const route of routes) {
    if (
      !route.usable ||
      !route.representative ||
      route.resolution !== "resolved" ||
      route.resolvedTarget?.kind !== "skill"
    ) {
      continue;
    }
    const targets = targetsBySource.get(route.sourceId) ?? new Set<string>();
    targets.add(route.resolvedTarget.id);
    targetsBySource.set(route.sourceId, targets);
  }
  return new Map(
    [...targetsBySource.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([sourceId, targets]) => [
        sourceId,
        [...targets].sort((left, right) => left.localeCompare(right)),
      ]),
  );
}

function minimumDepthsFromEntrypoint(
  entrypointId: string,
  adjacency: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, number> {
  const depths = new Map<string, number>([[entrypointId, 0]]);
  const queue = [entrypointId];
  for (let index = 0; index < queue.length; index += 1) {
    const sourceId = queue[index]!;
    const nextDepth = depths.get(sourceId)! + 1;
    for (const targetId of adjacency.get(sourceId) ?? []) {
      if (depths.has(targetId)) continue;
      depths.set(targetId, nextDepth);
      queue.push(targetId);
    }
  }
  return depths;
}

function publicationMarkerProjection(
  marker: CanonicalSkillPublicationField | undefined,
): SkillPublicationMarker {
  if (!marker) {
    return {
      state: "unsupported",
      canonicalKey: "metadata.renma.published-entrypoint",
      present: false,
      valid: false,
    };
  }
  const projection: SkillPublicationMarker = {
    state: marker.state,
    canonicalKey: "metadata.renma.published-entrypoint",
    present: marker.state !== "unsupported" && marker.state !== "absent",
    valid: marker.state === "valid",
    ...(marker.fieldEvidence
      ? { evidence: toEvidence(marker.fieldEvidence) }
      : {}),
    ...(marker.reason ? { reason: marker.reason } : {}),
  };
  if (Object.prototype.hasOwnProperty.call(marker, "rawValue")) {
    projection.rawValue = marker.rawValue;
  }
  return projection;
}

function publicationRejectionReasonsFor(
  markerState: CanonicalSkillPublicationFieldState,
  agentSkillsValid: boolean,
  lifecycleActive: boolean,
  effectiveIdUnique: boolean,
): SkillPublicationRejectionReason[] {
  if (markerState === "invalid") return ["invalid-marker"];
  if (markerState === "ambiguous") return ["ambiguous-marker"];
  if (markerState !== "valid") return [];
  const reasons: SkillPublicationRejectionReason[] = [];
  if (!agentSkillsValid) reasons.push("invalid-skill");
  if (!lifecycleActive) reasons.push("inactive-skill");
  if (!effectiveIdUnique) reasons.push("duplicate-skill-id");
  const unique = new Set(reasons);
  return SKILL_PUBLICATION_REJECTION_REASONS.filter((reason) =>
    unique.has(reason),
  );
}

function skillDiscoveryAdoption(
  discoveryMetadataPresent: boolean,
  repositoryWideAdopted: boolean,
  publishedEntrypointCount: number,
  configPath: string | undefined,
): SkillDiscoveryAdoption {
  if (!repositoryWideAdopted) {
    return {
      state: discoveryMetadataPresent ? "partial" : "not-adopted",
      discoveryMetadataPresent,
      repositoryWideAdopted: false,
      publishedEntrypointCount,
      reason: discoveryMetadataPresent
        ? "discovery-metadata-present-without-repository-adoption"
        : "no-discovery-metadata-or-repository-adoption",
      ...(configPath ? { configPath } : {}),
    };
  }
  return {
    state: publishedEntrypointCount > 0 ? "adopted" : "incomplete",
    discoveryMetadataPresent,
    repositoryWideAdopted: true,
    publishedEntrypointCount,
    reason:
      publishedEntrypointCount > 0
        ? "repository-adoption-has-effective-published-entrypoint"
        : "repository-adoption-has-no-effective-published-entrypoint",
    ...(configPath ? { configPath } : {}),
  };
}

function publicationDiagnosticFor(
  skill: VisibleSkillIdentity,
): Diagnostic | undefined {
  const marker = skill.publication.marker;
  const invalidMarker = marker.state === "invalid";
  const ambiguousMarker = marker.state === "ambiguous";
  const inactiveAttempt =
    marker.state === "valid" &&
    skill.agentSkillsValid &&
    !skill.lifecycleActive;
  if (!invalidMarker && !ambiguousMarker && !inactiveAttempt) return undefined;

  const reason = invalidMarker
    ? (marker.reason ?? 'the marker is not the exact YAML string "true"')
    : ambiguousMarker
      ? (marker.reason ?? "the marker declaration is ambiguous")
      : `the Skill lifecycle is ${skill.lifecycle ?? "inactive"}`;
  const action = ambiguousMarker
    ? "Resolve the declaration ambiguity with human review, then retain one exact intended marker or omit it."
    : inactiveAttempt
      ? "Remove the stale publication attempt or review the lifecycle decision; do not reactivate or clone the Skill merely to publish it."
      : 'Use the exact YAML string "true" to request publication, or omit the marker.';
  return {
    code: DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT,
    severity: "warning",
    path: skill.sourcePath,
    message: `Skill "${skill.id}" cannot be published because ${reason}. ${action}`,
    ...(marker.evidence ? { evidence: marker.evidence } : {}),
    repairConstraints: publicationRepairConstraints(ambiguousMarker),
    verificationSteps: publicationMarkerVerificationSteps(),
    llmHint:
      "Preserve the intended bounded first-hop responsibility. Do not publish every structural root, fabricate or clone a Skill, reactivate an inactive Skill merely to publish it, or guess through ambiguous evidence.",
    details: {
      sourceId: skill.id,
      sourcePath: skill.sourcePath,
      metadataKey: marker.canonicalKey,
      markerState: marker.state,
      markerReason: reason,
      ...(Object.prototype.hasOwnProperty.call(marker, "rawValue")
        ? { rawMarkerValue: marker.rawValue }
        : {}),
      ...(marker.evidence ? { rawMarkerEvidence: marker.evidence } : {}),
      ...(skill.lifecycle ? { lifecycle: skill.lifecycle } : {}),
      publicationRejectionReasons: skill.publication.rejectionReasons,
    },
  };
}

function publishedEntrypointBoundaryDiagnostic(
  skill: VisibleSkillIdentity,
): Diagnostic | undefined {
  if (!skill.publication.accepted) return undefined;
  const linked = PUBLISHED_ENTRYPOINT_BOUNDARIES.flatMap(({ code }) =>
    skill.linkedDiagnostics.filter((diagnostic) => diagnostic.code === code),
  );
  if (linked.length === 0) return undefined;
  const linkedCodes = new Set(linked.map((diagnostic) => diagnostic.code));
  const missing = PUBLISHED_ENTRYPOINT_BOUNDARIES.filter(({ code }) =>
    linkedCodes.has(code),
  ).map(({ label }) => label);
  const primaryEvidence = linked.find((diagnostic) => diagnostic.evidence)
    ?.evidence ?? {
    path: skill.sourcePath,
    startLine: 1,
    endLine: 1,
    snippet: "published entrypoint boundary evidence",
  };
  return {
    code: DIAGNOSTIC_IDS.DISCOVERY_ENTRYPOINT_WITHOUT_USABLE_BOUNDARIES,
    severity: "warning",
    path: skill.sourcePath,
    message: `Published entrypoint "${skill.id}" lacks deterministic first-hop boundary evidence for: ${missing.join(", ")}. Improve the source Skill's bounded responsibility; do not remove publication solely to suppress this warning.`,
    evidence: primaryEvidence,
    repairConstraints: publicationBoundaryRepairConstraints(),
    verificationSteps: publishedEntrypointBoundaryVerificationSteps(),
    llmHint:
      "Preserve the intended published first-hop responsibility and add the missing deterministic capability or selection boundary to the canonical Agent Skills description. Passing this warning is not proof of semantic completeness.",
    details: {
      sourceId: skill.id,
      sourcePath: skill.sourcePath,
      metadataKey: skill.publication.marker.canonicalKey,
      missingBoundaries: missing,
      publicationMarkerEvidence: skill.publication.marker.evidence,
      linkedDiagnostics: linked,
    },
  };
}

function unreachableEligibleSkillDiagnostic(
  skill: VisibleSkillIdentity,
  asset: Asset | undefined,
  coverage: Extract<SkillDiscoveryCoverage, { mode: "authoritative" }>,
  adoption: SkillDiscoveryAdoption,
): Diagnostic {
  const identityEvidence = asset?.metadataFields.id
    ? toEvidence(asset.metadataFields.id)
    : undefined;
  return {
    code: DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL,
    severity: "warning",
    path: skill.sourcePath,
    message: `Skill "${skill.id}" is not reached. No usable declared continuation path reaches this eligible Skill from any effective published entrypoint. This is static Discovery coverage evidence, not a claim that the Skill is unused at runtime.`,
    ...(identityEvidence ? { evidence: identityEvidence } : {}),
    repairConstraints: unreachableSkillRepairConstraints(),
    verificationSteps: unreachableSkillVerificationSteps(),
    llmHint:
      "Review whether this Skill is an independent entrypoint, belongs under a real existing workflow, or is outside the intended repository-wide Discovery policy. Do not invent a continuation or publish every Skill to silence the warning.",
    details: {
      sourceId: skill.id,
      sourcePath: skill.sourcePath,
      coverageMode: coverage.mode,
      adoptionState: adoption.state,
      publishedEntrypointIds: coverage.sourceEntrypointIds,
      structuralRoot: skill.structuralRoot,
      standalone: skill.standalone,
      unrouted: skill.unrouted,
      ...(adoption.configPath ? { configPath: adoption.configPath } : {}),
    },
  };
}

function routeCycleDiagnostic(cycle: SkillDiscoveryRouteCycle): Diagnostic {
  const primaryRoute = cycle.cycleRoutes[0]!;
  return {
    code: DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE,
    severity: "warning",
    path: primaryRoute.sourcePath,
    evidence: primaryRoute.evidence,
    message: `A usable declared Skill continuation cycle exists among Skills: ${cycle.cycleSkillIds.join(", ")}. Traversal remains cycle-safe. This is static route evidence for review, not proof of runtime recursion or an instruction to remove an edge.`,
    repairConstraints: routeCycleRepairConstraints(),
    verificationSteps: routeCycleVerificationSteps(),
    llmHint:
      "Review every internal continuation and decide whether the component is an intentional bounded workflow loop or an accidental circular contract. An intentional cycle may remain; do not remove an arbitrary edge merely to silence the warning.",
    details: {
      cycleSkillIds: cycle.cycleSkillIds,
      cycleSkills: cycle.cycleSkills,
      selfLoop: cycle.selfLoop,
      routeCount: cycle.cycleRoutes.length,
      cycleRoutes: cycle.cycleRoutes,
    },
  };
}

function routeCycleRepairConstraints(): NonNullable<
  Diagnostic["repairConstraints"]
> {
  return [
    {
      kind: "must_preserve",
      text: "Preserve the real workflow responsibilities, intended review or retry behavior, and source-owned continuation decisions.",
    },
    {
      kind: "must_not_change",
      text: "Do not remove an arbitrary route, publish or unpublish Skills, flatten the workflow, merge unrelated Skills, or break a valid review loop only to silence the warning.",
    },
    {
      kind: "allowed_change",
      text: "After reviewing every internal edge, remove or redirect a stale continuation when repository evidence supports it, or clarify bounded stop, ask, retry, handoff, and completion behavior in the owning Skill bodies when the cycle is intentional.",
    },
    {
      kind: "requires_human_decision",
      text: "Decide whether the component represents an intentional bounded workflow loop or an accidental circular continuation contract.",
    },
  ];
}

function routeCycleVerificationSteps(): NonNullable<
  Diagnostic["verificationSteps"]
> {
  return [
    {
      text: "Inspect the complete Discovery graph and confirm every reported internal edge is a real usable representative declaration.",
      command: "renma graph . --view discovery --format json",
      expected:
        "Cycle members and route evidence are complete and deterministic; no inferred, external, or unusable route participates.",
    },
    {
      text: "Inspect the canonical Skill Index and review the owning Skill bodies for bounded workflow behavior.",
      command: "renma skill-index . --format json",
      expected:
        "Intentional cycles retain explicit stop, ask, retry, handoff, or completion semantics; supported repairs remove accidental cycles without changing unrelated routes or publication.",
    },
    {
      text: "Run Renma scan and confirm unrelated route, publication, Agent Skills, and coverage diagnostics remain authoritative.",
      command: "renma scan . --format json",
      expected:
        "The reviewed cycle remains as intentional static evidence or is absent after evidence-backed route repair; unrelated diagnostics are unchanged.",
    },
  ];
}

function unreachableSkillRepairConstraints(): NonNullable<
  Diagnostic["repairConstraints"]
> {
  return [
    {
      kind: "must_preserve",
      text: "Preserve the Skill's actual responsibility and the repository's intended Discovery coverage policy.",
    },
    {
      kind: "must_not_change",
      text: "Do not add a fake continuation, publish every Skill, or merge unrelated workflows merely to silence the warning.",
    },
    {
      kind: "allowed_change",
      text: "After review, connect the Skill through a real source-owned continuation, publish it as an independent first hop when it genuinely is one, or revise repository-wide adoption when complete coverage was not actually intended.",
    },
    {
      kind: "requires_human_decision",
      text: "Decide whether the Skill is an independent entrypoint, belongs under an existing workflow, or is outside the intended repository-wide policy.",
    },
  ];
}

function unreachableSkillVerificationSteps(): NonNullable<
  Diagnostic["verificationSteps"]
> {
  const code = DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL;
  return [
    {
      text: "Inspect repository-wide Skill reachability from every effective published entrypoint after human review.",
      command: "renma graph . --view discovery --format json",
      expected:
        "The Skill is reachable through real usable declarations, is an intentionally published independent entrypoint, or repository-wide adoption has been revised after human review.",
    },
    {
      text: "Run Renma scan and confirm the reviewed coverage result preserves unrelated diagnostics.",
      command: "renma scan . --format json",
      expected: `The specific ${code} diagnostic is absent; unrelated route, publication, and Agent Skills diagnostics remain authoritative.`,
    },
  ];
}

function publicationRepairConstraints(
  ambiguous: boolean,
): NonNullable<Diagnostic["repairConstraints"]> {
  return [
    {
      kind: "must_preserve",
      text: "Preserve the intended bounded first-hop responsibility while repairing publication evidence.",
    },
    {
      kind: "must_not_change",
      text: "Do not publish every structural root automatically, fabricate or clone a Skill, or reactivate an inactive Skill merely to satisfy publication.",
    },
    {
      kind: "allowed_change",
      text: 'Retain one exact metadata.renma.published-entrypoint string "true" declaration when publication is intended, or omit the marker when it is not.',
    },
    ...(ambiguous
      ? [
          {
            kind: "requires_human_decision" as const,
            text: "Require human review when intended publication is ambiguous.",
          },
        ]
      : []),
  ];
}

function publicationBoundaryRepairConstraints(): NonNullable<
  Diagnostic["repairConstraints"]
> {
  return [
    {
      kind: "must_preserve",
      text: "Preserve the intended published first-hop responsibility and its routing semantics.",
    },
    {
      kind: "must_not_change",
      text: "Do not remove publication solely to suppress a boundary-quality warning or publish every structural root automatically.",
    },
    {
      kind: "allowed_change",
      text: "Improve the canonical Agent Skills description with the deterministically missing capability or selection boundary.",
    },
  ];
}

function resolveDeclaredRoute(
  source: VisibleSkillIdentity,
  declaration: CanonicalSkillContinuationItem,
  assets: Asset[],
  skillsByPath: Map<string, VisibleSkillIdentity>,
  idCounts: Map<string, number>,
): MutableRoute {
  const normalized = normalizeSkillRouteTarget(declaration.target);
  const resolution = resolveTarget(normalized, assets);
  const reasons: SkillRouteUsabilityReason[] = [
    ...source.routeEligibilityReasons,
  ];
  if (resolution.state === "unresolved") reasons.push("unresolved-target");
  if (resolution.state === "ambiguous") reasons.push("ambiguous-target");
  if (resolution.state === "wrong-kind") reasons.push("wrong-kind");

  const targetSkill = resolution.asset
    ? skillsByPath.get(resolution.asset.sourcePath)
    : undefined;
  if (resolution.state === "resolved" && targetSkill) {
    if (!targetSkill.agentSkillsValid) reasons.push("invalid-target");
    if (!targetSkill.lifecycleActive) reasons.push("inactive-target");
    if (!targetSkill.effectiveIdUnique) reasons.push("duplicate-target-id");
  }

  const linkedDiagnostics = [...source.linkedDiagnostics];
  if (resolution.asset) {
    const resolvedSkill = skillsByPath.get(resolution.asset.sourcePath);
    if (resolvedSkill)
      linkedDiagnostics.push(...resolvedSkill.linkedDiagnostics);
  }

  return {
    sourceId: source.id,
    sourcePath: source.sourcePath,
    declarationIndex: declaration.declarationIndex,
    rawTarget: declaration.rawTarget,
    normalizedTarget: normalized.value,
    ...(normalized.rejection
      ? { normalizationRejection: normalized.rejection }
      : {}),
    resolution: resolution.state,
    candidates: resolution.candidates,
    ...(resolution.asset
      ? {
          resolvedTarget: resolvedTarget(
            resolution.asset,
            skillsByPath,
            idCounts,
          ),
        }
      : {}),
    usable: reasons.length === 0,
    usabilityReasons: orderedReasons(reasons),
    representative: true,
    duplicateDeclarationIndices: [],
    evidence: declarationEvidence(declaration),
    linkedDiagnostics: uniqueDiagnosticLinks(linkedDiagnostics),
  };
}

function resolveTarget(
  normalized: NormalizedTarget,
  assets: Asset[],
): {
  state: SkillRouteResolutionState;
  candidates: SkillRouteCandidateIdentity[];
  asset?: Asset;
} {
  if (normalized.rejection) {
    return { state: "unresolved", candidates: [] };
  }
  const idMatches = assets.filter((asset) => asset.id === normalized.value);
  const pathMatches = assets.filter(
    (asset) => normalizeSourcePath(asset.sourcePath) === normalized.value,
  );
  const candidates = candidateIdentities(idMatches, pathMatches);
  if (idMatches.length > 1 || candidates.length > 1) {
    return { state: "ambiguous", candidates };
  }
  const asset = idMatches[0] ?? pathMatches[0];
  if (!asset) return { state: "unresolved", candidates: [] };
  return {
    state: asset.kind === "skill" ? "resolved" : "wrong-kind",
    candidates,
    asset,
  };
}

function candidateIdentities(
  idMatches: Asset[],
  pathMatches: Asset[],
): SkillRouteCandidateIdentity[] {
  const byPath = new Map<string, SkillRouteCandidateIdentity>();
  for (const [matchedBy, assets] of [
    ["id", idMatches],
    ["path", pathMatches],
  ] as const) {
    for (const asset of assets) {
      const existing = byPath.get(asset.sourcePath);
      if (existing) {
        if (!existing.matchedBy.includes(matchedBy)) {
          existing.matchedBy.push(matchedBy);
        }
        continue;
      }
      byPath.set(asset.sourcePath, {
        id: asset.id,
        sourcePath: asset.sourcePath,
        kind: asset.kind,
        ...(asset.metadata.status ? { lifecycle: asset.metadata.status } : {}),
        matchedBy: [matchedBy],
      });
    }
  }
  return [...byPath.values()].sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.id.localeCompare(right.id),
  );
}

function markDuplicateDeclarations(routes: MutableRoute[]): Diagnostic[] {
  const groups = new Map<string, MutableRoute[]>();
  for (const route of routes) {
    const resolvedSkillPath =
      route.resolution === "resolved" && route.resolvedTarget?.kind === "skill"
        ? route.resolvedTarget.sourcePath
        : undefined;
    const key = resolvedSkillPath
      ? `${route.sourcePath}\0skill:${resolvedSkillPath}`
      : route.resolution === "unresolved"
        ? `${route.sourcePath}\0spelling:${route.normalizedTarget}`
        : undefined;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), route]);
  }

  const diagnostics: Diagnostic[] = [];
  for (const duplicates of groups.values()) {
    if (duplicates.length < 2) continue;
    duplicates.sort(compareRoutes);
    const representative = duplicates[0]!;
    const indices = duplicates
      .map((route) => route.declarationIndex)
      .sort((left, right) => left - right);
    for (const route of duplicates) {
      route.duplicateDeclarationIndices = indices;
      if (route === representative) continue;
      route.representative = false;
      route.usabilityReasons = orderedReasons([
        ...route.usabilityReasons,
        "duplicate-declaration",
      ]);
      route.usable = false;
    }
    diagnostics.push(duplicateRouteDiagnostic(representative, duplicates));
  }
  return diagnostics;
}

function routeDiagnostics(
  route: MutableRoute,
  skillsByPath: Map<string, VisibleSkillIdentity>,
): Diagnostic[] {
  if (route.resolution === "unresolved" || route.resolution === "ambiguous") {
    return [unresolvedRouteDiagnostic(route)];
  }
  if (route.resolution === "wrong-kind" && route.resolvedTarget) {
    return [wrongKindRouteDiagnostic(route)];
  }
  if (
    route.resolution === "resolved" &&
    route.resolvedTarget?.kind === "skill" &&
    skillsByPath.get(route.sourcePath)?.routeEligible === true &&
    route.resolvedTarget.agentSkillsValid === true &&
    (route.resolvedTarget.lifecycle === "deprecated" ||
      route.resolvedTarget.lifecycle === "archived")
  ) {
    return [inactiveTargetDiagnostic(route)];
  }
  return [];
}

function invalidDeclarationDiagnostic(
  source: VisibleSkillIdentity,
  canonicalKey: string,
  reason: string,
  field: MetadataFieldEvidence | undefined,
): Diagnostic {
  return {
    code: DIAGNOSTIC_IDS.DISCOVERY_INVALID_CONTINUATION_DECLARATION,
    severity: "warning",
    path: source.sourcePath,
    message: `Invalid metadata.${canonicalKey}: ${reason}. Correct or remove the explicit Skill continuation declaration.`,
    ...(field ? { evidence: toEvidence(field) } : {}),
    repairConstraints: discoveryRepairConstraints(),
    verificationSteps: routeVerificationSteps(
      DIAGNOSTIC_IDS.DISCOVERY_INVALID_CONTINUATION_DECLARATION,
    ),
    llmHint:
      "Preserve the intended continuation relationship. Correct it to one JSON-array string of exact Skill IDs or repository-relative SKILL.md paths, or remove a stale declaration; do not create placeholder Skills.",
    details: {
      sourceId: source.id,
      sourcePath: source.sourcePath,
      metadataKey: `metadata.${canonicalKey}`,
      reason,
    },
  };
}

function unresolvedRouteDiagnostic(route: DeclaredSkillRoute): Diagnostic {
  const ambiguous = route.resolution === "ambiguous";
  const rejection = route.normalizationRejection
    ? ` The target was rejected as ${route.normalizationRejection.replace("-", " ")}.`
    : "";
  return {
    code: DIAGNOSTIC_IDS.DISCOVERY_UNRESOLVED_DECLARED_ROUTE,
    severity: "warning",
    path: route.sourcePath,
    message: `Skill "${route.sourceId}" continuation ${route.declarationIndex} ${ambiguous ? "is ambiguous" : "has no exact target"}: "${route.rawTarget}".${rejection} Use one exact stable Skill ID or repository-relative SKILL.md path.`,
    evidence: route.evidence,
    repairConstraints: discoveryRepairConstraints(ambiguous),
    verificationSteps: routeVerificationSteps(
      DIAGNOSTIC_IDS.DISCOVERY_UNRESOLVED_DECLARED_ROUTE,
    ),
    llmHint: ambiguous
      ? "Preserve the intended continuation and request human review to choose one exact candidate. Do not guess or create a placeholder Skill."
      : "Check for a stale or misspelled exact ID/path. Add a real missing Skill only when source evidence supports it. Do not create a placeholder Skill to satisfy validation.",
    details: {
      sourceId: route.sourceId,
      sourcePath: route.sourcePath,
      declarationIndex: route.declarationIndex,
      rawTarget: route.rawTarget,
      normalizedTarget: route.normalizedTarget,
      resolution: route.resolution,
      ...(route.normalizationRejection
        ? { normalizationRejection: route.normalizationRejection }
        : {}),
      candidates: route.candidates,
    },
  };
}

function wrongKindRouteDiagnostic(route: DeclaredSkillRoute): Diagnostic {
  const target = route.resolvedTarget!;
  return {
    code: DIAGNOSTIC_IDS.DISCOVERY_ROUTE_TARGET_NOT_SKILL,
    severity: "warning",
    path: route.sourcePath,
    message: `Skill continuation ${route.declarationIndex} resolves to ${target.kind} asset "${target.id}" at ${target.sourcePath}. Skill continuations are Skill-to-Skill only; use existing typed Context or Context Lens relationships for other asset kinds.`,
    evidence: route.evidence,
    repairConstraints: discoveryRepairConstraints(),
    verificationSteps: routeVerificationSteps(
      DIAGNOSTIC_IDS.DISCOVERY_ROUTE_TARGET_NOT_SKILL,
    ),
    llmHint:
      "Preserve the intended relationship, but do not convert Context or Lens dependencies into Skill routes. Use the existing typed metadata relationship or correct the target to a real Skill.",
    details: {
      sourceId: route.sourceId,
      sourcePath: route.sourcePath,
      declarationIndex: route.declarationIndex,
      rawTarget: route.rawTarget,
      normalizedTarget: route.normalizedTarget,
      target: target.id,
      targetKind: target.kind,
      targetPath: target.sourcePath,
    },
  };
}

function inactiveTargetDiagnostic(route: DeclaredSkillRoute): Diagnostic {
  const target = route.resolvedTarget!;
  return {
    code: DIAGNOSTIC_IDS.DISCOVERY_INACTIVE_ROUTE_TARGET,
    severity: "warning",
    path: route.sourcePath,
    message: `Skill continuation ${route.declarationIndex} targets ${target.lifecycle} Skill "${target.id}" at ${target.sourcePath}. The declaration remains visible but is unusable for structural Discovery.`,
    evidence: route.evidence,
    repairConstraints: discoveryRepairConstraints(),
    verificationSteps: routeVerificationSteps(
      DIAGNOSTIC_IDS.DISCOVERY_INACTIVE_ROUTE_TARGET,
    ),
    llmHint:
      "Preserve the intended continuation while reviewing a real active replacement. Correct or remove a stale declaration; do not reactivate or clone a Skill only to silence the warning.",
    details: {
      sourceId: route.sourceId,
      sourcePath: route.sourcePath,
      declarationIndex: route.declarationIndex,
      target: target.id,
      targetPath: target.sourcePath,
      targetStatus: target.lifecycle,
    },
  };
}

function duplicateRouteDiagnostic(
  representative: DeclaredSkillRoute,
  duplicates: DeclaredSkillRoute[],
): Diagnostic {
  const declarations = duplicates
    .map((route) => ({
      declarationIndex: route.declarationIndex,
      evidence: route.evidence,
    }))
    .sort((left, right) => left.declarationIndex - right.declarationIndex);
  const indices = declarations.map((item) => item.declarationIndex);
  return {
    code: DIAGNOSTIC_IDS.DISCOVERY_DUPLICATE_DECLARED_ROUTE,
    severity: "warning",
    path: representative.sourcePath,
    message: `Skill "${representative.sourceId}" declares the same continuation more than once at indices ${indices.join(", ")}. Declaration order is not priority; keep one exact declaration.`,
    evidence: representative.evidence,
    repairConstraints: discoveryRepairConstraints(),
    verificationSteps: routeVerificationSteps(
      DIAGNOSTIC_IDS.DISCOVERY_DUPLICATE_DECLARED_ROUTE,
    ),
    llmHint:
      "Preserve the intended continuation relationship and remove only redundant declaration items. Do not reorder declarations to imply priority.",
    details: {
      sourceId: representative.sourceId,
      sourcePath: representative.sourcePath,
      normalizedTarget: representative.normalizedTarget,
      declarationIndices: indices,
      declarations,
    },
  };
}

function discoveryRepairConstraints(
  ambiguous = false,
): NonNullable<Diagnostic["repairConstraints"]> {
  return [
    {
      kind: "must_preserve",
      text: "Preserve the intended Skill continuation relationship while correcting its exact declaration.",
    },
    {
      kind: "must_not_change",
      text: "Do not create a placeholder Skill merely to satisfy Discovery validation.",
    },
    {
      kind: "allowed_change",
      text: "Correct the exact ID/path, remove a stale declaration, or add a real missing Skill only when source evidence supports it.",
    },
    ...(ambiguous
      ? [
          {
            kind: "requires_human_decision" as const,
            text: "Request human review when repository evidence does not identify one intended target.",
          },
        ]
      : []),
  ];
}

function routeVerificationSteps(
  code: string,
): NonNullable<Diagnostic["verificationSteps"]> {
  return [
    {
      text: "Run the Discovery graph and confirm the declaration resolves with the intended usability state.",
      command: "renma graph . --view discovery --format json",
      expected: `No diagnostics with code ${code} remain for the repaired declaration.`,
    },
    {
      text: "Run Renma scan and confirm diagnostics v2 preserve the repaired relationship evidence.",
      command: "renma scan . --format json",
      expected: `No diagnostics with code ${code} remain for the repaired declaration.`,
    },
  ];
}

function publicationMarkerVerificationSteps(): NonNullable<
  Diagnostic["verificationSteps"]
> {
  const code = DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT;
  return [
    {
      text: "Run the Discovery graph and inspect the Skill's publication marker and effective publication state.",
      command: "renma graph . --view discovery --format json",
      expected: `The marker has the intended state, publication.accepted is correct, the rejected Skill is absent from publishedEntrypointIds unless it has become eligible, and no diagnostics with code ${code} remain after a valid repair.`,
    },
    {
      text: "Run Renma scan and confirm publication validation remains separate from existing Skill eligibility evidence.",
      command: "renma scan . --format json",
      expected: `No diagnostics with code ${code} remain after a valid repair; existing Agent Skills, lifecycle, and duplicate-ID diagnostics remain authoritative.`,
    },
  ];
}

function publishedEntrypointBoundaryVerificationSteps(): NonNullable<
  Diagnostic["verificationSteps"]
> {
  const code = DIAGNOSTIC_IDS.DISCOVERY_ENTRYPOINT_WITHOUT_USABLE_BOUNDARIES;
  return [
    {
      text: "Preserve the valid publication marker, improve the canonical Agent Skills description, and inspect the Discovery graph again.",
      command: "renma graph . --view discovery --format json",
      expected:
        "The Skill remains an effective published entrypoint and publication was not removed merely to suppress the boundary warning.",
    },
    {
      text: "Run Renma scan and confirm the deterministic description-boundary evidence is repaired.",
      command: "renma scan . --format json",
      expected: `The originating RN-SKILL-* boundary issue and ${code} are absent while the Skill remains published.`,
    },
  ];
}

function resolvedTarget(
  asset: Asset,
  skillsByPath: Map<string, VisibleSkillIdentity>,
  idCounts: Map<string, number>,
): ResolvedSkillRouteTarget {
  const skill = skillsByPath.get(asset.sourcePath);
  return {
    id: asset.id,
    sourcePath: asset.sourcePath,
    kind: asset.kind,
    ...(asset.metadata.status ? { lifecycle: asset.metadata.status } : {}),
    effectiveIdUnique: idCounts.get(asset.id) === 1,
    ...(skill ? { agentSkillsValid: skill.agentSkillsValid } : {}),
  };
}

function skillDiagnosticLinks(
  asset: Asset,
  validation: AgentSkillValidationResult | undefined,
  effectiveIdUnique: boolean,
): SkillDiagnosticLink[] {
  const links: SkillDiagnosticLink[] =
    validation?.issues.map((issue) => ({
      code: issue.code,
      evidence: {
        path: issue.path,
        startLine: issue.startLine,
        endLine: issue.endLine,
        snippet:
          issue.path === asset.sourcePath
            ? (asset.metadataFields[issue.field ?? ""]?.raw ?? issue.message)
            : issue.message,
      },
    })) ?? [];
  if (!effectiveIdUnique) {
    links.push({
      code: DIAGNOSTIC_IDS.META_DUPLICATE_ASSET_ID,
      evidence: metadataEvidence(asset.metadataFields.id, asset.sourcePath),
    });
  }
  return uniqueDiagnosticLinks(links);
}

function linkDiscoveryDiagnostics(
  routes: MutableRoute[],
  diagnostics: Diagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    if (!diagnostic.code || !diagnostic.path) continue;
    const diagnosticRouteKeys = routeKeysForDiagnostic(diagnostic);
    for (const route of routes) {
      if (diagnosticRouteKeys.length > 0) {
        if (!diagnosticRouteKeys.includes(routeKey(route))) continue;
      } else if (route.sourcePath !== diagnostic.path) continue;
      route.linkedDiagnostics = uniqueDiagnosticLinks([
        ...route.linkedDiagnostics,
        {
          code: diagnostic.code,
          ...(diagnostic.evidence ? { evidence: diagnostic.evidence } : {}),
        },
      ]);
    }
  }
}

function linkRouteCycleSkillDiagnostics(
  skills: VisibleSkillIdentity[],
  diagnostics: Diagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    if (diagnostic.code !== DIAGNOSTIC_IDS.DISCOVERY_ROUTE_CYCLE) continue;
    const memberPaths = new Set(
      detailRecordArray(diagnostic.details?.cycleSkills)
        .map((skill) => skill.sourcePath)
        .filter((sourcePath): sourcePath is string =>
          isNonEmptyString(sourcePath),
        ),
    );
    for (const skill of skills) {
      if (!memberPaths.has(skill.sourcePath)) continue;
      skill.linkedDiagnostics = uniqueDiagnosticLinks([
        ...skill.linkedDiagnostics,
        {
          code: diagnostic.code,
          ...(diagnostic.evidence ? { evidence: diagnostic.evidence } : {}),
        },
      ]);
    }
  }
}

function linkPublicationDiagnostics(
  skills: VisibleSkillIdentity[],
  diagnostics: Diagnostic[],
): void {
  const publicationCodes = new Set<string>([
    DIAGNOSTIC_IDS.DISCOVERY_INVALID_PUBLISHED_ENTRYPOINT,
    DIAGNOSTIC_IDS.DISCOVERY_ENTRYPOINT_WITHOUT_USABLE_BOUNDARIES,
  ]);
  for (const diagnostic of diagnostics) {
    if (
      !diagnostic.code ||
      !publicationCodes.has(diagnostic.code) ||
      !diagnostic.path
    ) {
      continue;
    }
    const skill = skills.find(
      (candidate) => candidate.sourcePath === diagnostic.path,
    );
    if (!skill) continue;
    skill.publication.linkedDiagnostics = uniqueDiagnosticLinks([
      ...skill.publication.linkedDiagnostics,
      {
        code: diagnostic.code,
        ...(diagnostic.evidence ? { evidence: diagnostic.evidence } : {}),
      },
    ]);
  }
}

function linkUnreachableDiagnostics(
  skills: VisibleSkillIdentity[],
  diagnostics: Diagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    if (
      diagnostic.code !== DIAGNOSTIC_IDS.DISCOVERY_UNREACHABLE_ELIGIBLE_SKILL ||
      !diagnostic.path
    ) {
      continue;
    }
    const skill = skills.find(
      (candidate) => candidate.sourcePath === diagnostic.path,
    );
    if (!skill) continue;
    skill.linkedDiagnostics = uniqueDiagnosticLinks([
      ...skill.linkedDiagnostics,
      {
        code: diagnostic.code,
        ...(diagnostic.evidence ? { evidence: diagnostic.evidence } : {}),
      },
    ]);
  }
}

function declarationEvidence(
  item: CanonicalSkillContinuationItem,
): SkillRouteDeclarationEvidence {
  return {
    ...toEvidence(item.evidence),
    metadataKey: "metadata.renma.continues-with",
    declarationIndex: item.declarationIndex,
  };
}

function toEvidence(field: MetadataFieldEvidence): Evidence {
  return {
    path: field.path,
    startLine: field.startLine,
    endLine: field.endLine,
    snippet: field.raw,
  };
}

function metadataEvidence(
  field: MetadataFieldEvidence | undefined,
  sourcePath: string,
): Evidence {
  return field
    ? toEvidence(field)
    : {
        path: sourcePath,
        startLine: 1,
        endLine: 1,
        snippet: "duplicate effective asset id",
      };
}

function summarizeDiscovery(
  skills: VisibleSkillIdentity[],
  routes: DeclaredSkillRoute[],
  publishedEntrypointIds: string[],
  structuralRootIds: string[],
  standaloneSkillIds: string[],
  unroutedSkillIds: string[],
  reachableDiscoveryEligibleSkillIds: string[],
  notReachedDiscoveryEligibleSkillIds: string[],
): SkillDiscoverySummary {
  const unresolvedRouteCount = routes.filter(
    (route) => route.resolution === "unresolved",
  ).length;
  const ambiguousRouteCount = routes.filter(
    (route) => route.resolution === "ambiguous",
  ).length;
  return {
    visibleSkillCount: skills.length,
    routeEligibleSkillCount: skills.filter((skill) => skill.routeEligible)
      .length,
    declaredRouteCount: routes.length,
    usableRouteCount: routes.filter((route) => route.usable).length,
    unresolvedRouteCount,
    ambiguousRouteCount,
    unresolvedOrAmbiguousRouteCount: unresolvedRouteCount + ambiguousRouteCount,
    invalidRouteCount: routes.filter(
      (route) =>
        !route.usable &&
        route.resolution !== "unresolved" &&
        route.resolution !== "ambiguous",
    ).length,
    structuralRootCount: structuralRootIds.length,
    standaloneSkillCount: standaloneSkillIds.length,
    unroutedSkillCount: unroutedSkillIds.length,
    publishedEntrypointCount: publishedEntrypointIds.length,
    reachableSkillCount: reachableDiscoveryEligibleSkillIds.length,
    notReachedSkillCount: notReachedDiscoveryEligibleSkillIds.length,
  };
}

function countAssetIds(assets: Asset[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const asset of assets)
    counts.set(asset.id, (counts.get(asset.id) ?? 0) + 1);
  return counts;
}

function orderedReasons(
  reasons: SkillRouteUsabilityReason[],
): SkillRouteUsabilityReason[] {
  const unique = new Set(reasons);
  return SKILL_ROUTE_USABILITY_REASONS.filter((reason) => unique.has(reason));
}

function uniqueDiagnosticLinks(
  links: SkillDiagnosticLink[],
): SkillDiagnosticLink[] {
  const keys = new Set<string>();
  return links
    .filter((link) => {
      const key = `${link.code}\0${link.evidence?.path ?? ""}\0${link.evidence?.startLine ?? 0}`;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        (left.evidence?.path ?? "").localeCompare(right.evidence?.path ?? "") ||
        (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0),
    );
}

function uniqueSkillsByPath(
  skills: VisibleSkillIdentity[],
): VisibleSkillIdentity[] {
  return [
    ...new Map(skills.map((skill) => [skill.sourcePath, skill])).values(),
  ].sort(compareVisibleSkills);
}

function normalizeSourcePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function compareVisibleSkills(
  left: VisibleSkillIdentity,
  right: VisibleSkillIdentity,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.id.localeCompare(right.id)
  );
}

function compareRoutes(
  left: DeclaredSkillRoute,
  right: DeclaredSkillRoute,
): number {
  return (
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.declarationIndex - right.declarationIndex ||
    left.normalizedTarget.localeCompare(right.normalizedTarget) ||
    left.rawTarget.localeCompare(right.rawTarget)
  );
}

function isAuthoritativeUsableSkillRoute(
  route: DeclaredSkillRoute,
): route is DeclaredSkillRoute & {
  resolvedTarget: ResolvedSkillRouteTarget & { kind: "skill" };
} {
  return (
    route.usable === true &&
    route.representative === true &&
    route.resolution === "resolved" &&
    route.resolvedTarget?.kind === "skill"
  );
}

function compareCycleRoutes(
  left: DeclaredSkillRoute & { resolvedTarget: ResolvedSkillRouteTarget },
  right: DeclaredSkillRoute & { resolvedTarget: ResolvedSkillRouteTarget },
): number {
  return (
    left.sourceId.localeCompare(right.sourceId) ||
    left.resolvedTarget.id.localeCompare(right.resolvedTarget.id) ||
    left.sourcePath.localeCompare(right.sourcePath) ||
    left.resolvedTarget.sourcePath.localeCompare(
      right.resolvedTarget.sourcePath,
    ) ||
    left.declarationIndex - right.declarationIndex
  );
}

function projectCycleRoute(
  route: DeclaredSkillRoute & { resolvedTarget: ResolvedSkillRouteTarget },
): SkillDiscoveryRouteCycleRoute {
  return {
    sourceId: route.sourceId,
    sourcePath: route.sourcePath,
    targetId: route.resolvedTarget.id,
    targetPath: route.resolvedTarget.sourcePath,
    declarationIndex: route.declarationIndex,
    evidence: route.evidence,
  };
}

function compareRouteCycles(
  left: SkillDiscoveryRouteCycle,
  right: SkillDiscoveryRouteCycle,
): number {
  const length = Math.max(
    left.cycleSkillIds.length,
    right.cycleSkillIds.length,
  );
  for (let index = 0; index < length; index += 1) {
    const comparison = (left.cycleSkillIds[index] ?? "").localeCompare(
      right.cycleSkillIds[index] ?? "",
    );
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function routeKeysForDiagnostic(diagnostic: Diagnostic): string[] {
  const cycleRouteKeys = detailRecordArray(
    diagnostic.details?.cycleRoutes,
  ).flatMap((route) =>
    isNonEmptyString(route.sourcePath) &&
    typeof route.declarationIndex === "number"
      ? [`${route.sourcePath}\0${route.declarationIndex.toString()}`]
      : [],
  );
  if (cycleRouteKeys.length > 0) {
    return [...new Set(cycleRouteKeys)].sort((left, right) =>
      left.localeCompare(right),
    );
  }
  if (!diagnostic.path) return [];
  if (typeof diagnostic.details?.declarationIndex === "number") {
    return [
      `${diagnostic.path}\0${diagnostic.details.declarationIndex.toString()}`,
    ];
  }
  if (Array.isArray(diagnostic.details?.declarationIndices)) {
    return diagnostic.details.declarationIndices
      .filter((item): item is number => typeof item === "number")
      .map((index) => `${diagnostic.path}\0${index.toString()}`)
      .sort((left, right) => left.localeCompare(right));
  }
  return [];
}

function routeKey(route: DeclaredSkillRoute): string {
  return `${route.sourcePath}\0${route.declarationIndex.toString()}`;
}

function detailRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    (left.code ?? "").localeCompare(right.code ?? "") ||
    (left.path ?? "").localeCompare(right.path ?? "") ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    left.message.localeCompare(right.message)
  );
}
