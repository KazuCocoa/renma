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
import type {
  AssetOwnership,
  Diagnostic,
  Evidence,
  MetadataFieldEvidence,
  ParsedDocument,
} from "./types.js";

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
  publishedEntrypointCount: number;
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

export interface SkillDiscoveryCoverage {
  mode: "not-evaluated";
  reason: "reachability-and-coverage-are-deferred";
}

/** Warning diagnostic emitted from explicit Skill continuation evidence. */
export type SkillDiscoveryDiagnostic = Diagnostic;

export interface SkillDiscoveryIndex {
  skills: VisibleSkillIdentity[];
  routes: DeclaredSkillRoute[];
  adoption: SkillDiscoveryAdoption;
  coverage: SkillDiscoveryCoverage;
  publishedEntrypointIds: string[];
  structuralRootIds: string[];
  standaloneSkillIds: string[];
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
  diagnostics.sort(compareDiagnostics);
  linkDiscoveryDiagnostics(routes, diagnostics);

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
  const coverage: SkillDiscoveryCoverage = {
    mode: "not-evaluated",
    reason: "reachability-and-coverage-are-deferred",
  };

  const publicRoutes: DeclaredSkillRoute[] = routes;
  return {
    skills,
    routes: publicRoutes,
    adoption,
    coverage,
    publishedEntrypointIds,
    structuralRootIds,
    standaloneSkillIds,
    summary: summarizeDiscovery(
      skills,
      publicRoutes,
      publishedEntrypointIds,
      structuralRootIds,
      standaloneSkillIds,
    ),
    diagnostics,
  };
}

/** Resolve an exact Skill focus and retain only its direct declared neighborhood. */
export function focusSkillDiscoveryIndex(
  index: SkillDiscoveryIndex,
  focus: string,
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
      `graph --focus did not match any Skill id or source path: ${focus}`,
    );
  }
  if (idMatches.length > 1 || matches.length > 1) {
    throw new Error(
      `graph --focus is ambiguous; use one exact repository-relative SKILL.md path: ${focus}`,
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
  const routeKeys = new Set(
    routes.map(
      (route) => `${route.sourcePath}\0${route.declarationIndex.toString()}`,
    ),
  );
  const diagnostics = index.diagnostics.filter((diagnostic) => {
    if (!diagnostic.path) return false;
    const declarationIndex = diagnostic.details?.declarationIndex;
    if (typeof declarationIndex === "number") {
      return routeKeys.has(
        `${diagnostic.path}\0${declarationIndex.toString()}`,
      );
    }
    const declarationIndices = diagnostic.details?.declarationIndices;
    if (Array.isArray(declarationIndices)) {
      return declarationIndices.some(
        (indexValue) =>
          typeof indexValue === "number" &&
          routeKeys.has(`${diagnostic.path}\0${indexValue.toString()}`),
      );
    }
    return visiblePaths.has(diagnostic.path);
  });

  return {
    skills,
    routes,
    adoption: index.adoption,
    coverage: index.coverage,
    publishedEntrypointIds,
    structuralRootIds,
    standaloneSkillIds,
    summary: summarizeDiscovery(
      skills,
      routes,
      publishedEntrypointIds,
      structuralRootIds,
      standaloneSkillIds,
    ),
    diagnostics,
    focus: { id: selected.id, sourcePath: selected.sourcePath },
  };
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
    linkedDiagnostics,
  };
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
    const declarationIndex =
      typeof diagnostic.details?.declarationIndex === "number"
        ? diagnostic.details.declarationIndex
        : undefined;
    const declarationIndices = Array.isArray(
      diagnostic.details?.declarationIndices,
    )
      ? diagnostic.details.declarationIndices.filter(
          (item): item is number => typeof item === "number",
        )
      : [];
    for (const route of routes) {
      if (route.sourcePath !== diagnostic.path) continue;
      if (
        declarationIndex !== undefined &&
        route.declarationIndex !== declarationIndex
      ) {
        continue;
      }
      if (
        declarationIndices.length > 0 &&
        !declarationIndices.includes(route.declarationIndex)
      ) {
        continue;
      }
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
    publishedEntrypointCount: publishedEntrypointIds.length,
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

function compareDiagnostics(left: Diagnostic, right: Diagnostic): number {
  return (
    (left.code ?? "").localeCompare(right.code ?? "") ||
    (left.path ?? "").localeCompare(right.path ?? "") ||
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0) ||
    left.message.localeCompare(right.message)
  );
}
